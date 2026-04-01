const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const { initDb, query, withClient } = require('./db');
const paymentProvider = require('./paymentProvider');
const mapsProvider = require('./mapsProvider');
const pushProvider = require('./pushProvider');


const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:4000';
const WEB_DIR = __dirname;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN, credentials: true } });

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: false
  })
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(express.static(WEB_DIR, { index: false }));

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(requiredRoles = []) {
  return (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return res.status(401).json({ error: 'Missing token' });
      const decoded = jwt.verify(token, JWT_SECRET);
      if (requiredRoles.length && !requiredRoles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      req.user = decoded;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

function toNumber(value) {
  return Number(Number(value || 0).toFixed(2));
}

function calcQuote(items) {
  const subtotal = toNumber(items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0));
  const itemCount = items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const deliveryFee = subtotal >= 1000 ? 0 : itemCount <= 3 ? 35 : 55;
  const platformFee = subtotal > 0 ? 12 : 0;
  const taxAmount = toNumber(subtotal * 0.02);
  const discountAmount = subtotal >= 2500 ? 120 : 0;
  const total = toNumber(subtotal + deliveryFee + platformFee + taxAmount - discountAmount);
  return { subtotal, deliveryFee, platformFee, taxAmount, discountAmount, total };
}

async function getUserByEmail(email) {
  const result = await query(`SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]);
  return result.rows[0] || null;
}

async function getOrderById(id) {
  const result = await query(
    `SELECT
      o.*,
      f.name AS farmer_name,
      s.name AS seller_name,
      s.business_name,
      s.gst_number,
      s.license_number,
      d.name AS delivery_partner_name
     FROM orders o
     JOIN users f ON f.id = o.farmer_id
     JOIN users s ON s.id = o.seller_id
     LEFT JOIN users d ON d.id = o.delivery_partner_id
     WHERE o.id = $1`,
    [id]
  );
  const order = result.rows[0];
  if (!order) return null;
  const items = await query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC`, [id]);
  const tracking = await query(`SELECT * FROM tracking_points WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
  return { ...order, items: items.rows, latestTracking: tracking.rows[0] || null, mapProvider: mapsProvider.getEmbedHint() };
}

async function listOrdersForUser(user) {
  let sql = '';
  const params = [];
  if (user.role === 'seller') {
    sql = `SELECT id FROM orders WHERE seller_id = $1 ORDER BY id DESC`;
    params.push(user.id);
  } else if (user.role === 'farmer') {
    sql = `SELECT id FROM orders WHERE farmer_id = $1 ORDER BY id DESC`;
    params.push(user.id);
  } else if (user.role === 'delivery') {
    sql = `SELECT id FROM orders WHERE delivery_partner_id = $1 ORDER BY id DESC`;
    params.push(user.id);
  } else if (user.role === 'admin') {
    sql = `SELECT id FROM orders ORDER BY id DESC LIMIT 100`;
  }
  const ids = await query(sql, params);
  const orders = [];
  for (const row of ids.rows) orders.push(await getOrderById(row.id));
  return orders;
}

async function emitOrderUpdate(orderId) {
  const order = await getOrderById(orderId);
  if (!order) return;
  io.to(`user:${order.farmer_id}`).emit('order:update', order);
  io.to(`user:${order.seller_id}`).emit('order:update', order);
  if (order.delivery_partner_id) io.to(`user:${order.delivery_partner_id}`).emit('order:update', order);
  io.to('role:admin').emit('order:update', order);
  io.to(`order:${order.id}`).emit('tracking:update', order.latestTracking || null);
}

async function logNotification(userId, title, body) {
  await query(`INSERT INTO notifications (user_id, title, body) VALUES ($1,$2,$3)`, [userId, title, body]);
  await pushProvider.notify({ userId, title, body });
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token || '';
    if (!token) return next(new Error('Unauthorized'));
    const user = jwt.verify(token, JWT_SECRET);
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);
  socket.join(`role:${socket.user.role}`);

  socket.on('track:subscribe', (orderId) => {
    if (orderId) socket.join(`order:${orderId}`);
  });

  socket.on('locationUpdate', (data = {}) => {
    const { lat, lng, heading = 0, speed = 0, orderId } = data;
    if (lat == null || lng == null) return;
    const payload = {
      latitude: Number(lat),
      longitude: Number(lng),
      heading: Number(heading || 0),
      speed: Number(speed || 0),
      created_at: new Date().toISOString()
    };
    if (orderId) io.to(`order:${orderId}`).emit('tracking:update', payload);
    else io.to(`user:${socket.user.id}`).emit('liveLocation', payload);
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'agri-realtime-marketplace-v2', time: new Date().toISOString() });
});


app.get('/api/payment-methods', (req, res) => {
  res.json([
    { code: 'cod', label: 'Cash on delivery', live: true },
    { code: 'upi', label: 'UPI transfer', live: true },
    { code: 'scanpay', label: 'Scan & Pay QR', live: true },
    { code: 'card', label: 'Card (provider hook)', live: false },
    { code: 'wallet', label: 'Wallet (provider hook)', live: false },
    { code: 'netbanking', label: 'Net banking (provider hook)', live: false }
  ]);
});

app.get('/api/me', auth(), async (req, res) => {
  const result = await query(`SELECT id, role, name, email, phone, business_name, shop_name, license_number, gst_number, seller_address, pesticide_license_number, business_type, upi_id, service_area, bank_account_name, bank_account_last4, ifsc_code, kyc_status, document_url, is_verified, created_at FROM users WHERE id = $1`, [req.user.id]);
  res.json(result.rows[0]);
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { role, name, email, phone, password, businessName = '', shopName = '', licenseNumber = '', gstNumber = '', sellerAddress = '', pesticideLicenseNumber = '', businessType = '', upiId = '', serviceArea = '', bankAccountName = '', bankAccountLast4 = '', ifscCode = '', documentUrl = '' } = req.body;
    if (!['seller', 'farmer', 'delivery'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    if (role === 'seller' && !licenseNumber) return res.status(400).json({ error: 'Seller license number is required' });
    if (role === 'seller' && !businessName) return res.status(400).json({ error: 'Seller business name is required' });
    const exists = await getUserByEmail(email);
    if (exists) return res.status(409).json({ error: 'Email already exists' });
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (role, name, email, phone, business_name, shop_name, license_number, gst_number, seller_address, pesticide_license_number, business_type, upi_id, service_area, bank_account_name, bank_account_last4, ifsc_code, document_url, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id, role, name, email, phone, business_name, shop_name, license_number, gst_number, seller_address, pesticide_license_number, business_type, upi_id, service_area, bank_account_name, bank_account_last4, ifsc_code, document_url, kyc_status, is_verified`,
      [role, name, email.toLowerCase(), phone || '', businessName || '', shopName || '', licenseNumber || '', gstNumber || '', sellerAddress || '', pesticideLicenseNumber || '', businessType || '', upiId || '', serviceArea || '', bankAccountName || '', bankAccountLast4 || '', ifscCode || '', documentUrl || '', passwordHash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const user = await getUserByEmail(email || '');
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (role && user.role !== role) return res.status(401).json({ error: 'Wrong role selected' });
    const ok = await bcrypt.compare(password || '', user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({
      token: signToken(user),
      user: { id: user.id, role: user.role, name: user.name, email: user.email, phone: user.phone, business_name: user.business_name, shop_name: user.shop_name, license_number: user.license_number, gst_number: user.gst_number, seller_address: user.seller_address, pesticide_license_number: user.pesticide_license_number, business_type: user.business_type, upi_id: user.upi_id, service_area: user.service_area, bank_account_name: user.bank_account_name, bank_account_last4: user.bank_account_last4, ifsc_code: user.ifsc_code, document_url: user.document_url, kyc_status: user.kyc_status, is_verified: user.is_verified }
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/delivery-partners', auth(['seller', 'admin']), async (req, res) => {
  const result = await query(`SELECT id, role, name, email, phone FROM users WHERE role = 'delivery' ORDER BY id DESC`);
  res.json(result.rows);
});

app.get('/api/users', auth(['admin']), async (req, res) => {
  const params = [];
  let sql = `SELECT id, role, name, email, phone, business_name, shop_name, license_number, gst_number, seller_address, pesticide_license_number, business_type, upi_id, service_area, bank_account_name, bank_account_last4, ifsc_code, kyc_status, document_url, is_verified, created_at FROM users`;
  if (req.query.role) {
    sql += ` WHERE role = $1`;
    params.push(req.query.role);
  }
  sql += ` ORDER BY id DESC`;
  const result = await query(sql, params);
  res.json(result.rows);
});


app.get('/api/seller/profile', auth(['seller', 'admin']), async (req, res) => {
  const userId = req.user.role === 'admin' ? Number(req.query.userId || req.user.id) : req.user.id;
  const result = await query(
    `SELECT id, role, name, email, phone, business_name, shop_name, license_number, gst_number, seller_address, pesticide_license_number, business_type, upi_id, service_area, bank_account_name, bank_account_last4, ifsc_code, document_url, kyc_status, is_verified, created_at
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Seller not found' });
  res.json(result.rows[0]);
});

app.put('/api/seller/profile', auth(['seller', 'admin']), async (req, res) => {
  const userId = req.user.role === 'admin' ? Number(req.body.userId || req.user.id) : req.user.id;
  const current = await query(`SELECT * FROM users WHERE id = $1`, [userId]);
  if (!current.rows[0]) return res.status(404).json({ error: 'Seller not found' });
  const payload = { ...current.rows[0], ...req.body };
  const result = await query(
    `UPDATE users SET
      name = $1,
      phone = $2,
      business_name = $3,
      shop_name = $4,
      license_number = $5,
      gst_number = $6,
      seller_address = $7,
      pesticide_license_number = $8,
      business_type = $9,
      upi_id = $10,
      service_area = $11,
      bank_account_name = $12,
      bank_account_last4 = $13,
      ifsc_code = $14,
      document_url = $15,
      is_verified = $16,
      kyc_status = $17
     WHERE id = $18
     RETURNING id, role, name, email, phone, business_name, shop_name, license_number, gst_number, seller_address, pesticide_license_number, business_type, upi_id, service_area, bank_account_name, bank_account_last4, ifsc_code, document_url, kyc_status, is_verified, created_at`,
    [
      payload.name,
      payload.phone || '',
      payload.businessName ?? payload.business_name ?? '',
      payload.shopName ?? payload.shop_name ?? '',
      payload.licenseNumber ?? payload.license_number ?? '',
      payload.gstNumber ?? payload.gst_number ?? '',
      payload.sellerAddress ?? payload.seller_address ?? '',
      payload.pesticideLicenseNumber ?? payload.pesticide_license_number ?? '',
      payload.businessType ?? payload.business_type ?? '',
      payload.upiId ?? payload.upi_id ?? '',
      payload.serviceArea ?? payload.service_area ?? '',
      payload.bankAccountName ?? payload.bank_account_name ?? '',
      payload.bankAccountLast4 ?? payload.bank_account_last4 ?? '',
      payload.ifscCode ?? payload.ifsc_code ?? '',
      payload.documentUrl ?? payload.document_url ?? '',
      req.user.role === 'admin' ? Boolean(payload.isVerified ?? payload.is_verified) : current.rows[0].is_verified,
      req.user.role === 'admin' ? (payload.kycStatus ?? payload.kyc_status ?? current.rows[0].kyc_status) : current.rows[0].kyc_status,
      userId
    ]
  );
  res.json(result.rows[0]);
});

app.get('/api/products', auth(), async (req, res) => {
  const params = [];
  let sql = `
    SELECT p.*, u.name AS seller_name
    FROM products p
    JOIN users u ON u.id = p.seller_id
    WHERE p.active = TRUE
  `;
  if (req.query.category && req.query.category !== 'all') {
    params.push(req.query.category);
    sql += ` AND p.category = $${params.length}`;
  }
  if (req.query.mine === '1' && req.user.role === 'seller') {
    params.push(req.user.id);
    sql += ` AND p.seller_id = $${params.length}`;
  }
  sql += ` ORDER BY p.id DESC`;
  const result = await query(sql, params);
  res.json(result.rows);
});

app.post('/api/products', auth(['seller', 'admin']), async (req, res) => {
  const { name, category, unit, price, stock, imageUrl, description } = req.body;
  if (!name || !category || !unit) return res.status(400).json({ error: 'Missing product fields' });
  const sellerId = req.user.role === 'seller' ? req.user.id : Number(req.body.sellerId || req.user.id);
  const result = await query(
    `INSERT INTO products (seller_id, name, category, unit, price, stock, image_url, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [sellerId, name, category, unit, Number(price || 0), Number(stock || 0), imageUrl || '', description || '']
  );
  res.status(201).json(result.rows[0]);
});

app.put('/api/products/:id', auth(['seller', 'admin']), async (req, res) => {
  const existing = await query(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
  const product = existing.rows[0];
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (req.user.role === 'seller' && product.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const payload = { ...product, ...req.body };
  const result = await query(
    `UPDATE products SET name=$1, category=$2, unit=$3, price=$4, stock=$5, image_url=$6, description=$7, updated_at=NOW() WHERE id=$8 RETURNING *`,
    [payload.name, payload.category, payload.unit, Number(payload.price), Number(payload.stock), payload.imageUrl || payload.image_url || '', payload.description || '', req.params.id]
  );
  res.json(result.rows[0]);
});

app.delete('/api/products/:id', auth(['seller', 'admin']), async (req, res) => {
  const existing = await query(`SELECT * FROM products WHERE id = $1`, [req.params.id]);
  const product = existing.rows[0];
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (req.user.role === 'seller' && product.seller_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  await query(`UPDATE products SET active = FALSE, updated_at = NOW() WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/orders/quote', auth(['farmer']), async (req, res) => {
  const items = req.body.items || [];
  if (!items.length) return res.status(400).json({ error: 'Cart is empty' });
  const productIds = items.map((x) => Number(x.productId)).filter(Boolean);
  const result = await query(`SELECT * FROM products WHERE id = ANY($1::int[]) AND active = TRUE`, [productIds]);
  const dbItems = result.rows;
  if (dbItems.length !== items.length) return res.status(400).json({ error: 'One or more products are invalid' });
  const sellerIds = [...new Set(dbItems.map((x) => x.seller_id))];
  if (sellerIds.length !== 1) return res.status(400).json({ error: 'One order can contain items from one seller only' });
  const normalized = items.map((item) => {
    const product = dbItems.find((p) => p.id === Number(item.productId));
    return { productId: product.id, quantity: Number(item.quantity), price: Number(product.price), stock: Number(product.stock), name: product.name };
  });
  for (const item of normalized) {
    if (item.quantity <= 0) return res.status(400).json({ error: 'Invalid quantity' });
    if (item.quantity > item.stock) return res.status(400).json({ error: `${item.name} exceeds stock` });
  }
  res.json(calcQuote(normalized));
});

app.post('/api/orders', auth(['farmer']), async (req, res) => {
  const items = req.body.items || [];
  const address = (req.body.address || '').trim();
  const note = (req.body.note || '').trim();
  const paymentMethod = req.body.paymentMethod || 'cod';
  if (!items.length) return res.status(400).json({ error: 'Cart is empty' });
  if (!address) return res.status(400).json({ error: 'Address is required' });

  const productIds = items.map((x) => Number(x.productId)).filter(Boolean);
  const productRes = await query(`SELECT * FROM products WHERE id = ANY($1::int[]) AND active = TRUE`, [productIds]);
  const dbItems = productRes.rows;
  if (dbItems.length !== items.length) return res.status(400).json({ error: 'One or more products are invalid' });
  const sellerIds = [...new Set(dbItems.map((x) => x.seller_id))];
  if (sellerIds.length !== 1) return res.status(400).json({ error: 'One order can contain items from one seller only' });

  const normalized = items.map((item) => {
    const product = dbItems.find((p) => p.id === Number(item.productId));
    return {
      productId: product.id,
      sellerId: product.seller_id,
      quantity: Number(item.quantity),
      price: Number(product.price),
      unit: product.unit,
      name: product.name,
      stock: Number(product.stock)
    };
  });
  for (const item of normalized) {
    if (item.quantity <= 0) return res.status(400).json({ error: 'Invalid quantity' });
    if (item.quantity > item.stock) return res.status(400).json({ error: `${item.name} exceeds stock` });
  }

  const quote = calcQuote(normalized);
  const paymentStatus = paymentMethod === 'cod' ? 'cod_pending' : 'pending';
  const orderId = await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const item of normalized) {
        await client.query(`UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND stock >= $1`, [item.quantity, item.productId]);
      }
      const orderResult = await client.query(
        `INSERT INTO orders (farmer_id, seller_id, status, payment_method, payment_status, subtotal, delivery_fee, platform_fee, tax_amount, discount_amount, total, address, note)
         VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [req.user.id, normalized[0].sellerId, paymentMethod, paymentStatus, quote.subtotal, quote.deliveryFee, quote.platformFee, quote.taxAmount, quote.discountAmount, quote.total, address, note]
      );
      const orderId = orderResult.rows[0].id;
      for (const item of normalized) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, seller_id, name, unit, price, quantity, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [orderId, item.productId, item.sellerId, item.name, item.unit, item.price, item.quantity, toNumber(item.price * item.quantity)]
        );
      }
      await client.query('COMMIT');
      return orderId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  const order = await getOrderById(orderId);
  await logNotification(order.seller_id, 'New order received', `Order #${order.id} is waiting for confirmation.`);
  await logNotification(order.farmer_id, 'Order placed', `Order #${order.id} was created successfully.`);
  await emitOrderUpdate(order.id);

  let paymentIntegration = null;
  if (paymentMethod !== 'cod') {
    paymentIntegration = await paymentProvider.createIntent({ order, method: paymentMethod });
  }
  res.status(201).json({ order, paymentIntegration });
});

app.get('/api/orders', auth(), async (req, res) => {
  res.json(await listOrdersForUser(req.user));
});

app.patch('/api/orders/:id/status', auth(['seller', 'delivery', 'admin', 'farmer']), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const nextStatus = req.body.status;
  const allowed = ['pending', 'confirmed', 'packed', 'assigned', 'picked_up', 'in_transit', 'delivered', 'cancelled'];
  if (!allowed.includes(nextStatus)) return res.status(400).json({ error: 'Invalid status' });

  const user = req.user;
  const farmerCanCancel = user.role === 'farmer' && user.id === order.farmer_id && nextStatus === 'cancelled' && ['pending', 'confirmed'].includes(order.status);
  const sellerCanEdit = user.role === 'seller' && user.id === order.seller_id;
  const deliveryCanEdit = user.role === 'delivery' && user.id === order.delivery_partner_id;
  const adminCanEdit = user.role === 'admin';
  if (!(farmerCanCancel || sellerCanEdit || deliveryCanEdit || adminCanEdit)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  await query(`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`, [nextStatus, order.id]);
  const updated = await getOrderById(order.id);
  await logNotification(updated.farmer_id, 'Order status updated', `Order #${updated.id} is now ${nextStatus.replaceAll('_', ' ')}.`);
  await logNotification(updated.seller_id, 'Order status updated', `Order #${updated.id} is now ${nextStatus.replaceAll('_', ' ')}.`);
  if (updated.delivery_partner_id) await logNotification(updated.delivery_partner_id, 'Run updated', `Order #${updated.id} is now ${nextStatus.replaceAll('_', ' ')}.`);
  await emitOrderUpdate(updated.id);
  res.json(updated);
});

app.patch('/api/orders/:id/assign', auth(['seller', 'admin']), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (req.user.role === 'seller' && req.user.id !== order.seller_id) return res.status(403).json({ error: 'Forbidden' });
  const deliveryPartnerId = Number(req.body.deliveryPartnerId);
  const riderRes = await query(`SELECT id, role, name FROM users WHERE id = $1 AND role = 'delivery'`, [deliveryPartnerId]);
  const rider = riderRes.rows[0];
  if (!rider) return res.status(400).json({ error: 'Invalid delivery partner' });
  await query(`UPDATE orders SET delivery_partner_id = $1, status = 'assigned', updated_at = NOW() WHERE id = $2`, [deliveryPartnerId, order.id]);
  const updated = await getOrderById(order.id);
  await logNotification(updated.delivery_partner_id, 'New run assigned', `Order #${updated.id} was assigned to you.`);
  await emitOrderUpdate(updated.id);
  res.json(updated);
});


app.patch('/api/orders/:id/accept-run', auth(['delivery', 'admin']), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (req.user.role === 'delivery' && req.user.id !== order.delivery_partner_id) return res.status(403).json({ error: 'Forbidden' });
  await query(`UPDATE orders SET status = 'picked_up', updated_at = NOW() WHERE id = $1`, [order.id]);
  const updated = await getOrderById(order.id);
  await logNotification(updated.farmer_id, 'Rider picked the order', `Order #${updated.id} is now on the way.`);
  await emitOrderUpdate(updated.id);
  res.json(updated);
});

app.post('/api/orders/:id/payment-intent', auth(['farmer', 'admin']), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (req.user.role === 'farmer' && req.user.id !== order.farmer_id) return res.status(403).json({ error: 'Forbidden' });
  const method = req.body.method || order.payment_method;
  const intent = await paymentProvider.createIntent({ order, method, customer: req.user });
  if (intent.providerOrderId) {
    await query(`UPDATE orders SET provider_order_id = $1, updated_at = NOW() WHERE id = $2`, [intent.providerOrderId, order.id]);
  }
  res.json(intent);
});

app.post('/api/orders/:id/payment-confirm', auth(['farmer', 'admin']), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (req.user.role === 'farmer' && req.user.id !== order.farmer_id) return res.status(403).json({ error: 'Forbidden' });
  const confirmation = await paymentProvider.confirmPayment({
    orderId: order.id,
    providerPaymentId: req.body.providerPaymentId,
    status: req.body.status || 'paid',
    meta: req.body.meta || {}
  });
  await query(`UPDATE orders SET payment_status = $1, provider_payment_id = $2, updated_at = NOW() WHERE id = $3`, [confirmation.normalizedStatus, confirmation.providerPaymentId || '', order.id]);
  const updated = await getOrderById(order.id);
  await emitOrderUpdate(updated.id);
  res.json(updated);
});

app.post('/api/orders/:id/tracking', auth(['delivery', 'admin']), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (req.user.role === 'delivery' && req.user.id !== order.delivery_partner_id) return res.status(403).json({ error: 'Forbidden' });
  const { latitude, longitude, heading = 0, speed = 0 } = req.body;
  if (latitude == null || longitude == null) return res.status(400).json({ error: 'latitude and longitude are required' });
  await query(
    `INSERT INTO tracking_points (order_id, delivery_partner_id, latitude, longitude, heading, speed)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [order.id, order.delivery_partner_id || req.user.id, latitude, longitude, heading, speed]
  );
  await emitOrderUpdate(order.id);
  res.json({ ok: true });
});

app.get('/api/orders/:id/tracking', auth(), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const allowed = req.user.role === 'admin' || [order.farmer_id, order.seller_id, order.delivery_partner_id].includes(req.user.id);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  const result = await query(`SELECT * FROM tracking_points WHERE order_id = $1 ORDER BY id DESC LIMIT 50`, [order.id]);
  res.json({ latest: order.latestTracking, points: result.rows });
});

app.post('/api/notifications/token', auth(), async (req, res) => {
  await query(`UPDATE users SET device_token = $1 WHERE id = $2`, [req.body.deviceToken || '', req.user.id]);
  res.json({ ok: true });
});

app.get('/api/notifications', auth(), async (req, res) => {
  const result = await query(`SELECT id, title, body, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 20`, [req.user.id]);
  res.json(result.rows);
});


app.patch('/api/admin/sellers/:id/verify', auth(['admin']), async (req, res) => {
  const sellerId = Number(req.params.id);
  const { isVerified = true, kycStatus = 'approved' } = req.body || {};
  const result = await query(
    `UPDATE users SET is_verified = $1, kyc_status = $2 WHERE id = $3 AND role = 'seller'
     RETURNING id, role, name, email, phone, business_name, shop_name, license_number, gst_number, seller_address, pesticide_license_number, business_type, upi_id, service_area, bank_account_name, bank_account_last4, ifsc_code, document_url, kyc_status, is_verified, created_at`,
    [Boolean(isVerified), String(kycStatus), sellerId]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Seller not found' });
  await logNotification(sellerId, 'Seller verification updated', `Your verification status is now ${kycStatus}.`);
  res.json(result.rows[0]);
});

app.get('/api/orders/:id/invoice', auth(), async (req, res) => {
  const order = await getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const allowed = req.user.role === 'admin' || [order.farmer_id, order.seller_id, order.delivery_partner_id].includes(req.user.id);
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });
  const invoice = {
    invoiceNumber: `INV-${String(order.id).padStart(6, '0')}`,
    orderId: order.id,
    createdAt: order.created_at,
    seller: {
      name: order.seller_name,
      businessName: order.business_name || order.seller_name,
      gstNumber: order.gst_number || '',
      licenseNumber: order.license_number || ''
    },
    customer: { name: order.farmer_name, address: order.address },
    items: order.items.map(item => ({ name: item.name, unit: item.unit, quantity: item.quantity, price: Number(item.price), lineTotal: Number(item.line_total) })),
    summary: {
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.delivery_fee),
      platformFee: Number(order.platform_fee),
      taxAmount: Number(order.tax_amount),
      discountAmount: Number(order.discount_amount),
      total: Number(order.total),
      paymentMethod: order.payment_method,
      paymentStatus: order.payment_status
    }
  };
  res.json(invoice);
});

app.get('/api/admin/overview', auth(['admin']), async (req, res) => {
  const [users, products, orders, revenue] = await Promise.all([
    query(`SELECT role, COUNT(*)::int AS count FROM users GROUP BY role ORDER BY role`),
    query(`SELECT category, COUNT(*)::int AS count FROM products WHERE active = TRUE GROUP BY category ORDER BY category`),
    query(`SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status ORDER BY status`),
    query(`SELECT COALESCE(SUM(total),0)::numeric::float8 AS total FROM orders WHERE payment_status IN ('paid','cod_pending')`)
  ]);
  res.json({ users: users.rows, products: products.rows, orders: orders.rows, revenue: revenue.rows[0].total });
});

app.get('/api/ready', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Database not ready' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

(async () => {
  try {
    await initDb();
    server.listen(PORT, () => {
      console.log(`Agri marketplace v2 running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Startup failed:', error.message || error);
    if (String(error.message || '').includes('Database password missing')) {
      console.error('Open .env and set PGPASSWORD for your local PostgreSQL running on localhost:5432.');
    }
    process.exit(1);
  }
})();

