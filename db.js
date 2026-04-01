require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool;

function buildPoolConfig() {
  const connectionString = String(process.env.DATABASE_URL || '').trim();
  if (connectionString) {
    return { connectionString };
  }

  const password = process.env.PGPASSWORD;
  if (password == null || String(password).trim() === '') {
    throw new Error('Database password missing. Open .env and set PGPASSWORD.');
  }

  return {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'agri_marketplace',
    user: process.env.PGUSER || 'postgres',
    password: String(password),
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(buildPoolConfig());
  }
  return pool;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function withClient(fn) {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('seller','farmer','delivery','admin')),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT DEFAULT '',
      business_name TEXT DEFAULT '',
      shop_name TEXT DEFAULT '',
      license_number TEXT DEFAULT '',
      gst_number TEXT DEFAULT '',
      seller_address TEXT DEFAULT '',
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      password_hash TEXT NOT NULL,
      pesticide_license_number TEXT DEFAULT '',
      business_type TEXT DEFAULT '',
      upi_id TEXT DEFAULT '',
      service_area TEXT DEFAULT '',
      bank_account_name TEXT DEFAULT '',
      bank_account_last4 TEXT DEFAULT '',
      ifsc_code TEXT DEFAULT '',
      kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','approved','rejected')),
      document_url TEXT DEFAULT '',
      device_token TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_name TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS license_number TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS gst_number TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_address TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pesticide_license_number TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS upi_id TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS service_area TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_name TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bank_account_last4 TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ifsc_code TEXT DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS document_url TEXT DEFAULT '';

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('fertilizer','vegetable')),
      unit TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      image_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      farmer_id INTEGER NOT NULL REFERENCES users(id),
      seller_id INTEGER NOT NULL REFERENCES users(id),
      delivery_partner_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','packed','assigned','picked_up','in_transit','delivered','cancelled')),
      payment_method TEXT NOT NULL DEFAULT 'cod',
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','failed','refunded','cod_pending')),
      provider_order_id TEXT DEFAULT '',
      provider_payment_id TEXT DEFAULT '',
      subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
      delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
      platform_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      total NUMERIC(10,2) NOT NULL DEFAULT 0,
      address TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      seller_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      quantity INTEGER NOT NULL,
      line_total NUMERIC(10,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracking_points (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      delivery_partner_id INTEGER NOT NULL REFERENCES users(id),
      latitude NUMERIC(10,6) NOT NULL,
      longitude NUMERIC(10,6) NOT NULL,
      heading NUMERIC(10,2) DEFAULT 0,
      speed NUMERIC(10,2) DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_seller_id ON products(seller_id);
    CREATE INDEX IF NOT EXISTS idx_orders_farmer_id ON orders(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_seller_id ON orders(seller_id);
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_partner_id ON orders(delivery_partner_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_order_id ON tracking_points(order_id);
  `);

  const countRes = await query(`SELECT COUNT(*)::int AS count FROM users`);
  if (countRes.rows[0].count > 0) return;

  const passwordHash = await bcrypt.hash('password123', 10);
  const seller = await query(
    `INSERT INTO users (role, name, email, phone, business_name, shop_name, license_number, gst_number, seller_address, is_verified, pesticide_license_number, business_type, upi_id, service_area, bank_account_name, bank_account_last4, ifsc_code, kyc_status, document_url, password_hash)
     VALUES ('seller',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    ['Green Seller', 'seller@example.com', '9876543210', 'Green Seller Agro Supplies', 'Green Seller Agro Mart', 'TN-AGRI-LIC-2026-001', '33ABCDE1234F1Z5', 'Koyambedu Market, Chennai', true, 'TN-PST-2026-044', 'Wholesale + Retail', 'greenseller@upi', 'Chennai North & Central', 'Green Seller Agro Supplies', '8244', 'SBIN0001234', 'approved', 'https://example.com/kyc/greenseller', passwordHash]
  );
  const farmer = await query(
    `INSERT INTO users (role, name, email, phone, password_hash) VALUES ('farmer',$1,$2,$3,$4) RETURNING id`,
    ['Ravi Farmer', 'farmer@example.com', '9123456780', passwordHash]
  );
  const delivery = await query(
    `INSERT INTO users (role, name, email, phone, password_hash) VALUES ('delivery',$1,$2,$3,$4) RETURNING id`,
    ['Swift Rider', 'delivery@example.com', '9988776655', passwordHash]
  );
  await query(
    `INSERT INTO users (role, name, email, phone, password_hash) VALUES ('admin',$1,$2,$3,$4)`,
    ['Platform Admin', 'admin@example.com', '9000000000', passwordHash]
  );

  const sellerId = seller.rows[0].id;
  const seedProducts = [
    ['Urea Fertilizer', 'fertilizer', 'bag', 560, 40, 'Fast-release nitrogen support for field crops.'],
    ['DAP Fertilizer', 'fertilizer', 'bag', 1350, 20, 'Strong phosphorus support for healthy root development.'],
    ['Fresh Tomatoes', 'vegetable', 'kg', 28, 150, 'Daily-fresh tomatoes sourced from local farms.'],
    ['Green Chillies', 'vegetable', 'kg', 64, 65, 'Spicy green chillies for retail and wholesale orders.'],
    ['Onions Premium', 'vegetable', 'kg', 34, 220, 'Clean sorted onions for everyday delivery.']
  ];
  for (const [name, category, unit, price, stock, description] of seedProducts) {
    await query(
      `INSERT INTO products (seller_id, name, category, unit, price, stock, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [sellerId, name, category, unit, price, stock, description]
    );
  }

  const tomato = await query(`SELECT id, price, seller_id, unit, name FROM products WHERE name='Fresh Tomatoes' LIMIT 1`);
  const urea = await query(`SELECT id, price, seller_id, unit, name FROM products WHERE name='Urea Fertilizer' LIMIT 1`);
  const farmerId = farmer.rows[0].id;
  const deliveryId = delivery.rows[0].id;
  const subtotal = Number(tomato.rows[0].price) * 6 + Number(urea.rows[0].price) * 1;
  const deliveryFee = 35;
  const platformFee = 12;
  const taxAmount = Number((subtotal * 0.02).toFixed(2));
  const total = subtotal + deliveryFee + platformFee + taxAmount;
  const order = await query(
    `INSERT INTO orders (farmer_id, seller_id, delivery_partner_id, status, payment_method, payment_status, subtotal, delivery_fee, platform_fee, tax_amount, discount_amount, total, address, note)
     VALUES ($1,$2,$3,'in_transit','upi','paid',$4,$5,$6,$7,0,$8,$9,$10) RETURNING id`,
    [farmerId, sellerId, deliveryId, subtotal, deliveryFee, platformFee, taxAmount, total, 'Chennai, Tamil Nadu', 'Call before arrival']
  );
  await query(
    `INSERT INTO order_items (order_id, product_id, seller_id, name, unit, price, quantity, line_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8),
            ($1,$9,$3,$10,$11,$12,$13,$14)`,
    [order.rows[0].id, tomato.rows[0].id, sellerId, tomato.rows[0].name, tomato.rows[0].unit, tomato.rows[0].price, 6, Number(tomato.rows[0].price) * 6,
      urea.rows[0].id, urea.rows[0].name, urea.rows[0].unit, urea.rows[0].price, 1, Number(urea.rows[0].price)]
  );
  await query(
    `INSERT INTO tracking_points (order_id, delivery_partner_id, latitude, longitude, heading, speed)
     VALUES ($1,$2,13.082700,80.270700,90,24)`,
    [order.rows[0].id, deliveryId]
  );
}

module.exports = { getPool, query, withClient, initDb };
