const API_BASE = `${location.origin}/api`;
const state = {
  token: localStorage.getItem('agri_v3_token') || '',
  user: null,
  authMode: 'login',
  authRole: 'farmer',
  page: 'dashboard',
  socket: null,
  map: null,
  mapMarker: null,
  mapDeliveryMarker: null,
  mapTrailLine: null,
  mapTrailGlow: null,
  mapPickupMarker: null,
  mapDropMarker: null,
  mapFocusBoundsDone: false,
  trackingPoints: [],
  riderAnimationFrame: null,
  products: [],
  orders: [],
  riders: [],
  notifications: [],
  users: [],
  adminOverview: null,
  sellerProfile: null,
  paymentMethods: [],
  cart: [],
  filterCategory: 'all',
  currentTrackingOrderId: null,
  liveShare: { active: false, watchId: null, orderId: null },
  flash: { ok: '', error: '' },
  forms: {
    login: { email: '', password: '' },
    register: { name: '', email: '', phone: '', password: '', businessName: '', shopName: '', licenseNumber: '', gstNumber: '', sellerAddress: '', pesticideLicenseNumber: '', businessType: '', upiId: '', serviceArea: '', bankAccountName: '', bankAccountLast4: '', ifscCode: '', documentUrl: '' },
    product: { name: '', category: 'vegetable', unit: 'kg', price: '', stock: '', imageUrl: '', description: '' },
    checkout: { address: 'Chennai, Tamil Nadu', note: '', paymentMethod: 'cod' },
    seller: { name: '', phone: '', businessName: '', shopName: '', licenseNumber: '', gstNumber: '', sellerAddress: '', pesticideLicenseNumber: '', businessType: '', upiId: '', serviceArea: '', bankAccountName: '', bankAccountLast4: '', ifscCode: '', documentUrl: '' }
  }
};
const app = document.getElementById('app');
boot();

async function boot() {
  try {
    state.paymentMethods = await apiPublic('/payment-methods');
  } catch {}
  if (state.token) {
    try {
      state.user = await api('/me');
      connectSocket();
      await hydrate();
    } catch {
      logout(false);
    }
  }
  render();
}

async function hydrate() {
  await Promise.all([loadProducts(), loadOrders(), loadNotifications(), maybeLoadRiders(), maybeLoadAdmin(), maybeLoadSellerProfile()]);
}

async function maybeLoadRiders() {
  if (state.user && ['seller', 'admin'].includes(state.user.role)) {
    state.riders = await api('/delivery-partners');
  }
}

async function maybeLoadAdmin() {
  if (state.user?.role === 'admin') {
    const [overview, users] = await Promise.all([api('/admin/overview'), api('/users')]);
    state.adminOverview = overview;
    state.users = users;
  }
}

async function maybeLoadSellerProfile() {
  if (state.user?.role === 'seller') {
    state.sellerProfile = await api('/seller/profile');
    state.forms.seller = {
      name: state.sellerProfile.name || '',
      phone: state.sellerProfile.phone || '',
      businessName: state.sellerProfile.business_name || '',
      shopName: state.sellerProfile.shop_name || '',
      licenseNumber: state.sellerProfile.license_number || '',
      gstNumber: state.sellerProfile.gst_number || '',
      sellerAddress: state.sellerProfile.seller_address || '',
      pesticideLicenseNumber: state.sellerProfile.pesticide_license_number || '',
      businessType: state.sellerProfile.business_type || '',
      upiId: state.sellerProfile.upi_id || '',
      serviceArea: state.sellerProfile.service_area || '',
      bankAccountName: state.sellerProfile.bank_account_name || '',
      bankAccountLast4: state.sellerProfile.bank_account_last4 || '',
      ifscCode: state.sellerProfile.ifsc_code || '',
      documentUrl: state.sellerProfile.document_url || ''
    };
  }
}

async function loadProducts() {
  if (!state.token) return;
  const mine = state.user?.role === 'seller' && state.page === 'catalog' ? '&mine=1' : '';
  state.products = await api(`/products?category=${state.filterCategory}${mine}`);
}

async function loadOrders() { if (state.token) state.orders = await api('/orders'); }
async function loadNotifications() { if (state.token) state.notifications = await api('/notifications'); }

function connectSocket() {
  if (state.socket || !state.token) return;
  state.socket = io({ auth: { token: state.token } });
  state.socket.on('order:update', (order) => {
    mergeOrder(order);
    if (String(state.currentTrackingOrderId) === String(order.id)) updateMap(order.latestTracking);
    render();
  });
  state.socket.on('tracking:update', (point) => {
    const order = state.orders.find((x) => String(x.id) === String(state.currentTrackingOrderId));
    if (order) {
      order.latestTracking = point;
      if (point && point.created_at && !state.trackingPoints.find((x) => x.created_at === point.created_at)) {
        state.trackingPoints.push(point);
      }
      updateMap(point);
      render();
    }
  });
}

function mergeOrder(incoming) {
  const index = state.orders.findIndex((o) => String(o.id) === String(incoming.id));
  if (index >= 0) state.orders[index] = incoming;
  else state.orders.unshift(incoming);
}

function saveToken(token) {
  state.token = token;
  localStorage.setItem('agri_v3_token', token);
}

function logout(renderNow = true) {
  if (state.liveShare.watchId) navigator.geolocation?.clearWatch(state.liveShare.watchId);
  state.liveShare = { active: false, watchId: null, orderId: null };
  localStorage.removeItem('agri_v3_token');
  state.token = '';
  state.user = null;
  state.products = [];
  state.orders = [];
  state.riders = [];
  state.notifications = [];
  state.users = [];
  state.adminOverview = null;
  state.sellerProfile = null;
  state.cart = [];
  if (state.socket) { state.socket.disconnect(); state.socket = null; }
  if (renderNow) render();
}

async function apiPublic(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function setFlash(ok = '', error = '') { state.flash = { ok, error }; render(); }
function update(path, value) { const parts = path.split('.'); let ref = state; while (parts.length > 1) ref = ref[parts.shift()]; ref[parts[0]] = value; }

async function submitAuth(event) {
  event.preventDefault();
  try {
    const payload = state.authMode === 'login'
      ? { ...state.forms.login, role: state.authRole }
      : { ...state.forms.register, role: state.authRole };
    const endpoint = state.authMode === 'login' ? '/auth/login' : '/auth/register';
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    saveToken(data.token);
    state.user = data.user;
    state.page = 'dashboard';
    connectSocket();
    await hydrate();
    setFlash(`Welcome, ${state.user.name}.`, '');
  } catch (error) {
    setFlash('', error.message);
  }
}

async function addProduct(event) {
  event.preventDefault();
  try {
    const payload = { ...state.forms.product, price: Number(state.forms.product.price), stock: Number(state.forms.product.stock) };
    await api('/products', { method: 'POST', body: JSON.stringify(payload) });
    state.forms.product = { name: '', category: 'vegetable', unit: 'kg', price: '', stock: '', imageUrl: '', description: '' };
    await loadProducts();
    setFlash('Product added successfully.', '');
  } catch (error) { setFlash('', error.message); }
}

async function saveSellerProfile(event) {
  event?.preventDefault?.();
  try {
    const updated = await api('/seller/profile', { method: 'PUT', body: JSON.stringify(state.forms.seller) });
    state.sellerProfile = updated;
    state.user.name = updated.name;
    state.user.phone = updated.phone;
    setFlash('Seller profile updated.', '');
  } catch (error) { setFlash('', error.message); }
}

async function deleteProduct(id) {
  try { await api(`/products/${id}`, { method: 'DELETE' }); await loadProducts(); setFlash('Product removed.', ''); }
  catch (error) { setFlash('', error.message); }
}

function addToCart(product) {
  const sameSeller = state.cart.length ? state.cart[0].product.seller_id === product.seller_id : true;
  if (!sameSeller) return setFlash('', 'One order can contain items from one seller only.');
  const existing = state.cart.find((item) => item.productId === product.id);
  if (existing) existing.quantity += 1;
  else state.cart.push({ productId: product.id, quantity: 1, product });
  render();
}

function changeQty(productId, delta) {
  const item = state.cart.find((entry) => entry.productId === productId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry.productId !== productId);
  render();
}

async function placeOrder() {
  try {
    const payload = {
      items: state.cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      address: state.forms.checkout.address,
      note: state.forms.checkout.note,
      paymentMethod: state.forms.checkout.paymentMethod
    };
    const data = await api('/orders', { method: 'POST', body: JSON.stringify(payload) });
    state.cart = [];
    await loadOrders();
    const msg = data.paymentIntegration?.message ? ` ${data.paymentIntegration.message}` : '';
    setFlash(`Order #${data.order.id} created.${msg}`, '');
  } catch (error) { setFlash('', error.message); }
}

async function updateStatus(orderId, status) {
  try { await api(`/orders/${orderId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadOrders(); setFlash('Order updated.', ''); }
  catch (error) { setFlash('', error.message); }
}

async function assignRider(orderId, deliveryPartnerId) {
  if (!deliveryPartnerId) return;
  try { await api(`/orders/${orderId}/assign`, { method: 'PATCH', body: JSON.stringify({ deliveryPartnerId }) }); await loadOrders(); setFlash('Delivery partner assigned.', ''); }
  catch (error) { setFlash('', error.message); }
}

async function acceptRun(orderId) {
  try { await api(`/orders/${orderId}/accept-run`, { method: 'PATCH' }); await loadOrders(); setFlash('Run accepted and marked picked up.', ''); }
  catch (error) { setFlash('', error.message); }
}

async function createPaymentIntent(orderId) {
  try {
    const order = state.orders.find((x) => x.id === orderId);
    const data = await api(`/orders/${orderId}/payment-intent`, { method: 'POST', body: JSON.stringify({ method: order.payment_method }) });
    const extra = data.upiId ? ` UPI ID: ${data.upiId}` : '';
    const qr = data.qrPayload ? ` QR payload ready.` : '';
    setFlash(`Payment instructions ready.${extra}${qr}`, '');
  } catch (error) { setFlash('', error.message); }
}

async function confirmPayment(orderId) {
  try {
    await api(`/orders/${orderId}/payment-confirm`, { method: 'POST', body: JSON.stringify({ providerPaymentId: `manual_${Date.now()}`, status: 'paid' }) });
    await loadOrders();
    setFlash('Payment marked as paid.', '');
  } catch (error) { setFlash('', error.message); }
}

async function viewTracking(orderId) {
  state.currentTrackingOrderId = orderId;
  state.socket?.emit('track:subscribe', orderId);
  state.mapFocusBoundsDone = false;
  await loadTracking(orderId);
  render();
  setTimeout(() => updateMap(getCurrentTrackedOrder()?.latestTracking), 0);
}

function getCurrentTrackedOrder() { return state.orders.find((order) => String(order.id) === String(state.currentTrackingOrderId)) || state.orders[0] || null; }

async function loadTracking(orderId) {
  try {
    const data = await api(`/orders/${orderId}/tracking`);
    state.trackingPoints = (data.points || []).slice().reverse();
    const order = state.orders.find((x) => String(x.id) === String(orderId));
    if (order && data.latest) order.latestTracking = data.latest;
  } catch (error) {
    setFlash('', error.message);
  }
}


function startLiveShare(orderId) {
  if (!navigator.geolocation) return setFlash('', 'Geolocation is not supported in this browser.');
  if (state.liveShare.watchId) navigator.geolocation.clearWatch(state.liveShare.watchId);
  const watchId = navigator.geolocation.watchPosition(async (position) => {
    try {
      await api(`/orders/${orderId}/tracking`, {
        method: 'POST',
        body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude, heading: position.coords.heading || 0, speed: position.coords.speed || 0 })
      });
    } catch (error) { setFlash('', error.message); }
  }, (error) => setFlash('', error.message), { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 });
  state.liveShare = { active: true, watchId, orderId };
  setFlash('Live location sharing started.', '');
}

function stopLiveShare() {
  if (state.liveShare.watchId) navigator.geolocation.clearWatch(state.liveShare.watchId);
  state.liveShare = { active: false, watchId: null, orderId: null };
  setFlash('Live location sharing stopped.', '');
}

function roleNav() {
  const role = state.user.role;
  if (role === 'seller') return ['dashboard', 'profile', 'catalog', 'orders', 'tracking', 'notifications'];
  if (role === 'farmer') return ['dashboard', 'browse', 'checkout', 'orders', 'tracking', 'notifications'];
  if (role === 'delivery') return ['dashboard', 'runs', 'tracking', 'notifications'];
  if (role === 'admin') return ['dashboard', 'users', 'orders', 'catalog', 'notifications'];
  return ['dashboard'];
}

function pageTitle() {
  const map = { dashboard: 'Overview', browse: 'Browse products', checkout: 'Checkout', orders: 'Orders', tracking: 'Tracking board', catalog: 'Catalog', runs: 'Assigned runs', users: 'Users', notifications: 'Notifications', profile: 'Seller profile' };
  return map[state.page] || 'Dashboard';
}

function render() { app.innerHTML = state.user ? renderApp() : renderAuth(); if (state.user && state.page === 'tracking') setupMap(); }
function renderFlash() { return `${state.flash.ok ? `<div class="notice">${escapeHtml(state.flash.ok)}</div>` : ''}${state.flash.error ? `<div class="error">${escapeHtml(state.flash.error)}</div>` : ''}`; }

function renderAuth() {
  const roleCards = {
    seller: 'Register as a verified seller with business, shop, license, GST, and address details.',
    farmer: 'Order fertilizers and vegetables with clean checkout and live tracking.',
    delivery: 'Receive runs and share live location while delivering.',
    admin: 'Platform-wide visibility for launch operations.'
  };
  const sellerExtra = state.authRole === 'seller' && state.authMode === 'register' ? `
    <label><span>Business name</span><input required value="${escapeHtml(state.forms.register.businessName)}" oninput="update('forms.register.businessName', this.value)" /></label>
    <label><span>Shop name</span><input value="${escapeHtml(state.forms.register.shopName)}" oninput="update('forms.register.shopName', this.value)" /></label>
    <label><span>License number</span><input required value="${escapeHtml(state.forms.register.licenseNumber)}" oninput="update('forms.register.licenseNumber', this.value)" /></label>
    <label><span>GST number</span><input value="${escapeHtml(state.forms.register.gstNumber)}" oninput="update('forms.register.gstNumber', this.value)" /></label>
    <label><span>Pesticide license</span><input value="${escapeHtml(state.forms.register.pesticideLicenseNumber)}" oninput="update('forms.register.pesticideLicenseNumber', this.value)" /></label>
    <label><span>Business type</span><input value="${escapeHtml(state.forms.register.businessType)}" oninput="update('forms.register.businessType', this.value)" /></label>
    <label><span>UPI ID</span><input value="${escapeHtml(state.forms.register.upiId)}" oninput="update('forms.register.upiId', this.value)" /></label>
    <label><span>Service area</span><input value="${escapeHtml(state.forms.register.serviceArea)}" oninput="update('forms.register.serviceArea', this.value)" /></label>
    <label><span>Bank account name</span><input value="${escapeHtml(state.forms.register.bankAccountName)}" oninput="update('forms.register.bankAccountName', this.value)" /></label>
    <label><span>Bank account last 4</span><input value="${escapeHtml(state.forms.register.bankAccountLast4)}" oninput="update('forms.register.bankAccountLast4', this.value)" /></label>
    <label><span>IFSC code</span><input value="${escapeHtml(state.forms.register.ifscCode)}" oninput="update('forms.register.ifscCode', this.value)" /></label>
    <label class="span-2"><span>Document URL</span><input value="${escapeHtml(state.forms.register.documentUrl)}" oninput="update('forms.register.documentUrl', this.value)" /></label>
    <label class="span-2"><span>Seller address</span><textarea rows="3" oninput="update('forms.register.sellerAddress', this.value)">${escapeHtml(state.forms.register.sellerAddress)}</textarea></label>
  ` : '';
  return `
    <div class="container" style="padding:24px;max-width:1320px;margin:0 auto;">
      <div class="hero">
        <section class="card stack">
          <div class="eyebrow">Launch-ready marketplace</div>
          <h1>Clear, fast, real-time delivery for fertilizers and vegetables.</h1>
          <p class="subtitle">Seller verification, manual UPI, delivery assignment, and free live maps are all wired for a practical first launch.</p>
          <div class="grid-3">
            <div class="feature"><strong>Seller operations</strong><span class="muted">Business profile, license and GST details, catalog, stock, and order fulfilment.</span></div>
            <div class="feature"><strong>Farmer ordering</strong><span class="muted">Bill breakdown, payment choices, order timeline, and live rider tracking.</span></div>
            <div class="feature"><strong>Delivery execution</strong><span class="muted">Assigned runs, pickup acceptance, live sharing, and delivered status.</span></div>
          </div>
          <div class="card compact" style="background:linear-gradient(135deg,#f0fdf4,#fff7ed)">
            <div class="eyebrow">Demo access</div>
            <div class="grid-2">
              <div><strong>seller@example.com</strong><div class="muted">password123</div></div>
              <div><strong>farmer@example.com</strong><div class="muted">password123</div></div>
              <div><strong>delivery@example.com</strong><div class="muted">password123</div></div>
              <div><strong>admin@example.com</strong><div class="muted">password123</div></div>
            </div>
          </div>
        </section>
        <section class="card stack">
          <div><div class="eyebrow">Portal access</div><h3 style="margin:10px 0 6px">${state.authMode === 'login' ? 'Sign in' : 'Create account'}</h3><p class="subtitle">${roleCards[state.authRole]}</p></div>
          ${renderFlash()}
          <div class="role-picker">${['seller','farmer','delivery','admin'].map(role => `<button class="${state.authRole === role ? 'active' : ''}" onclick="setAuthRole('${role}')">${labelize(role)}</button>`).join('')}</div>
          <div class="segmented">
            <button class="${state.authMode === 'login' ? 'active' : ''}" onclick="setAuthMode('login')">Login</button>
            <button class="${state.authMode === 'register' ? 'active' : ''}" onclick="setAuthMode('register')">Register</button>
          </div>
          <form class="form-grid" onsubmit="submitAuth(event)">
            ${state.authMode === 'register' ? `<label><span>Name</span><input required value="${escapeHtml(state.forms.register.name)}" oninput="update('forms.register.name', this.value)" /></label><label><span>Phone</span><input value="${escapeHtml(state.forms.register.phone)}" oninput="update('forms.register.phone', this.value)" /></label>` : ''}
            <label class="${state.authMode === 'login' ? 'span-2' : ''}"><span>Email</span><input required type="email" value="${escapeHtml(state.authMode === 'login' ? state.forms.login.email : state.forms.register.email)}" oninput="update('${state.authMode === 'login' ? 'forms.login.email' : 'forms.register.email'}', this.value)" /></label>
            <label class="${state.authMode === 'login' ? 'span-2' : ''}"><span>Password</span><input required type="password" value="${escapeHtml(state.authMode === 'login' ? state.forms.login.password : state.forms.register.password)}" oninput="update('${state.authMode === 'login' ? 'forms.login.password' : 'forms.register.password'}', this.value)" /></label>
            ${sellerExtra}
            <div class="span-2 row"><button class="btn" type="submit">${state.authMode === 'login' ? 'Enter dashboard' : 'Create account'}</button></div>
          </form>
        </section>
      </div>
    </div>
  `;
}

function renderApp() {
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><div class="logo">K</div><div><h1>KisanKart v3</h1><p>Realtime agri delivery</p></div></div>
        <div class="role-badge">${labelize(state.user.role)}</div>
        <div class="nav">${roleNav().map(item => `<button class="${state.page === item ? 'active' : ''}" onclick="setPage('${item}')">${labelize(item)}</button>`).join('')}</div>
        <div class="cardish">
          <strong>${escapeHtml(state.user.name)}</strong>
          <div class="small">${escapeHtml(state.user.email)}</div>
          <div class="small">${escapeHtml(state.user.phone || 'No phone added')}</div>
          ${state.user.role === 'seller' && state.sellerProfile ? `<div class="${state.sellerProfile.is_verified ? 'verified' : 'pending-badge'}" style="margin-top:10px">${state.sellerProfile.is_verified ? 'Verified seller' : 'Verification pending'}</div>` : ''}
        </div>
        <button class="ghost" onclick="logout()">Logout</button>
      </aside>
      <main class="main">
        <div class="container stack">
          <div class="topbar"><div><h2>${pageTitle()}</h2><p>${subheadingForPage()}</p></div><div class="row"><button class="btn-outline" onclick="refreshNow()">Refresh</button>${state.user.role === 'farmer' ? `<button class="btn" onclick="setPage('checkout')">Cart (${state.cart.reduce((s, x) => s + x.quantity, 0)})</button>` : ''}</div></div>
          ${renderFlash()}
          ${renderPage()}
        </div>
      </main>
    </div>
  `;
}

function subheadingForPage() {
  const role = state.user?.role;
  if (state.page === 'dashboard' && role === 'seller') return 'Business profile, stock, orders, payments, and rider assignment.';
  if (state.page === 'dashboard' && role === 'farmer') return 'Your latest orders, current cart value, payment options, and live tracking.';
  if (state.page === 'dashboard' && role === 'delivery') return 'Assigned runs, acceptance flow, and live movement updates.';
  if (state.page === 'dashboard' && role === 'admin') return 'Launch operations snapshot across users, products, and orders.';
  if (state.page === 'profile') return 'Keep your seller profile complete for trust and compliance.';
  return 'A clean role-based view designed for daily use.';
}

function renderPage() {
  if (state.page === 'dashboard') return renderDashboard();
  if (state.page === 'browse') return renderBrowse();
  if (state.page === 'checkout') return renderCheckout();
  if (state.page === 'orders' || state.page === 'runs') return renderOrders();
  if (state.page === 'tracking') return renderTracking();
  if (state.page === 'catalog') return renderCatalog();
  if (state.page === 'users') return renderUsers();
  if (state.page === 'notifications') return renderNotifications();
  if (state.page === 'profile') return renderSellerProfile();
  return renderDashboard();
}

function renderDashboard() {
  const orders = filteredOrdersForPage();
  const active = orders.filter((o) => ['confirmed','packed','assigned','picked_up','in_transit'].includes(o.status)).length;
  const revenue = orders.filter((o) => ['paid','cod_pending'].includes(o.payment_status)).reduce((sum, o) => sum + Number(o.total), 0);
  const cardThree = state.user.role === 'farmer' ? money(cartQuoteSync()?.total || 0) : state.user.role === 'delivery' ? active : money(revenue);
  const cardThreeLabel = state.user.role === 'farmer' ? 'Cart total' : state.user.role === 'delivery' ? 'Active runs' : 'Revenue';
  return `
    <section class="stats-grid">
      <div class="metric"><div class="label">Products</div><div class="value">${state.products.length}</div><div class="muted">Available to this role</div></div>
      <div class="metric"><div class="label">Orders</div><div class="value">${orders.length}</div><div class="muted">Visible right now</div></div>
      <div class="metric"><div class="label">${cardThreeLabel}</div><div class="value">${cardThree}</div><div class="muted">Current live value</div></div>
      <div class="metric"><div class="label">Notifications</div><div class="value">${state.notifications.length}</div><div class="muted">Most recent updates</div></div>
    </section>
    <section class="dashboard-grid">
      <div class="stack">
        ${state.user.role === 'seller' && state.sellerProfile ? sellerSummaryCard() : ''}
        <div class="card">
          <div class="inline-split"><div><div class="eyebrow">Realtime feed</div><h3 style="margin:8px 0 6px">Recent orders</h3></div><button class="btn-secondary" onclick="setPage('orders')">Open full list</button></div>
          <div class="order-grid">${orders.slice(0,4).map(orderCard).join('') || `<div class="empty">No orders yet.</div>`}</div>
        </div>
      </div>
      <div class="stack">
        <div class="card"><div class="eyebrow">Quick actions</div><div class="stack">${quickActionCards()}</div></div>
        <div class="card compact"><div class="eyebrow">Recent notifications</div><div class="stack">${state.notifications.slice(0,5).map(note => `<div class="mini-card"><strong>${escapeHtml(note.title)}</strong><div class="muted">${escapeHtml(note.body)}</div><div class="muted">${fmtDate(note.created_at)}</div></div>`).join('') || `<div class="empty">No notifications yet.</div>`}</div></div>
      </div>
      <div class="card stack">
        <div class="eyebrow">Seller approvals</div>
        <div class="stack">${state.users.filter(u => u.role === 'seller').map(user => `<div class="mini-card"><div class="inline-split"><strong>${escapeHtml(user.business_name || user.name)}</strong><span class="${user.is_verified ? 'verified' : 'pending-badge'}">${user.is_verified ? 'Verified' : labelize(user.kyc_status || 'pending')}</span></div><div class="muted">License: ${escapeHtml(user.license_number || '-')} · GST: ${escapeHtml(user.gst_number || '-')}</div><div class="muted">UPI: ${escapeHtml(user.upi_id || '-')} · Area: ${escapeHtml(user.service_area || '-')}</div><div class="row"><button class="btn-outline" onclick="approveSeller(${user.id}, true)">Approve</button><button class="btn-danger" onclick="approveSeller(${user.id}, false)">Reject</button>${user.document_url ? `<a class=\"btn-secondary\" href=\"${escapeHtml(user.document_url)}\" target=\"_blank\" rel=\"noreferrer\">KYC doc</a>` : ''}</div></div>`).join('') || `<div class="empty">No sellers found.</div>`}</div>
      </div>
    </section>
  `;
}

function sellerSummaryCard() {
  const s = state.sellerProfile;
  return `
    <div class="profile-card">
      <div class="inline-split">
        <div><div class="eyebrow">Seller profile</div><h3 style="margin:8px 0 6px">${escapeHtml(s.business_name || s.name)}</h3><div class="muted">${escapeHtml(s.shop_name || 'No shop name')}</div></div>
        <div class="${s.is_verified ? 'verified' : 'pending-badge'}">${s.is_verified ? 'Verified seller' : 'Verification pending'}</div>
      </div>
      <div class="kpi-grid">
        <div class="mini-card"><strong>License</strong><div class="muted">${escapeHtml(s.license_number || 'Not added')}</div></div>
        <div class="mini-card"><strong>GST</strong><div class="muted">${escapeHtml(s.gst_number || 'Not added')}</div></div>
        <div class="mini-card"><strong>Address</strong><div class="muted">${escapeHtml(s.seller_address || 'Not added')}</div></div>
        <div class="mini-card"><strong>UPI</strong><div class="muted">${escapeHtml(s.upi_id || 'Not added')}</div></div>
        <div class="mini-card"><strong>KYC</strong><div class="muted">${escapeHtml(labelize(s.kyc_status || 'pending'))}</div></div>
      </div>
    </div>
  `;
}

function quickActionCards() {
  if (state.user.role === 'seller') return `<div class="mini-card"><strong>Complete seller profile</strong><div class="muted">Keep license, GST, and address ready for trust.</div><button class="btn" onclick="setPage('profile')">Open profile</button></div><div class="mini-card"><strong>Add a new product</strong><div class="muted">Update catalog and stock quickly.</div><button class="btn-secondary" onclick="setPage('catalog')">Open catalog</button></div>`;
  if (state.user.role === 'farmer') return `<div class="mini-card"><strong>Browse today’s supply</strong><div class="muted">Fertilizers and vegetables in one simple list.</div><button class="btn" onclick="setPage('browse')">Browse products</button></div><div class="mini-card"><strong>Finish checkout</strong><div class="muted">Choose payment method and place order.</div><button class="btn-secondary" onclick="setPage('checkout')">Open checkout</button></div>`;
  if (state.user.role === 'delivery') return `<div class="mini-card"><strong>Open assigned runs</strong><div class="muted">Accept pickup, update status, and deliver smoothly.</div><button class="btn" onclick="setPage('runs')">Open runs</button></div><div class="mini-card"><strong>Share live location</strong><div class="muted">Let seller and farmer watch the delivery in real time.</div><button class="btn-secondary" onclick="setPage('tracking')">Open tracking</button></div>`;
  return `<div class="mini-card"><strong>Review launch operations</strong><div class="muted">Monitor users, inventory, and order health.</div><button class="btn" onclick="setPage('users')">Open users</button></div>`;
}

function renderSellerProfile() {
  const s = state.sellerProfile || {};
  return `
    <section class="dashboard-grid">
      <div class="card stack">
        <div><div class="eyebrow">Business details</div><h3 style="margin:8px 0 6px">Verified seller information</h3></div>
        <form class="mini-form" onsubmit="saveSellerProfile(event)">
          <label><span>Contact name</span><input required value="${escapeHtml(state.forms.seller.name)}" oninput="update('forms.seller.name', this.value)" /></label>
          <label><span>Phone</span><input value="${escapeHtml(state.forms.seller.phone)}" oninput="update('forms.seller.phone', this.value)" /></label>
          <label><span>Business name</span><input required value="${escapeHtml(state.forms.seller.businessName)}" oninput="update('forms.seller.businessName', this.value)" /></label>
          <label><span>Shop name</span><input value="${escapeHtml(state.forms.seller.shopName)}" oninput="update('forms.seller.shopName', this.value)" /></label>
          <label><span>License number</span><input required value="${escapeHtml(state.forms.seller.licenseNumber)}" oninput="update('forms.seller.licenseNumber', this.value)" /></label>
          <label><span>GST number</span><input value="${escapeHtml(state.forms.seller.gstNumber)}" oninput="update('forms.seller.gstNumber', this.value)" /></label>
          <label><span>Pesticide license</span><input value="${escapeHtml(state.forms.seller.pesticideLicenseNumber)}" oninput="update('forms.seller.pesticideLicenseNumber', this.value)" /></label>
          <label><span>Business type</span><input value="${escapeHtml(state.forms.seller.businessType)}" oninput="update('forms.seller.businessType', this.value)" /></label>
          <label><span>UPI ID</span><input value="${escapeHtml(state.forms.seller.upiId)}" oninput="update('forms.seller.upiId', this.value)" /></label>
          <label><span>Service area</span><input value="${escapeHtml(state.forms.seller.serviceArea)}" oninput="update('forms.seller.serviceArea', this.value)" /></label>
          <label><span>Bank account name</span><input value="${escapeHtml(state.forms.seller.bankAccountName)}" oninput="update('forms.seller.bankAccountName', this.value)" /></label>
          <label><span>Bank account last 4</span><input value="${escapeHtml(state.forms.seller.bankAccountLast4)}" oninput="update('forms.seller.bankAccountLast4', this.value)" /></label>
          <label><span>IFSC code</span><input value="${escapeHtml(state.forms.seller.ifscCode)}" oninput="update('forms.seller.ifscCode', this.value)" /></label>
          <label class="span-2"><span>Document URL</span><input value="${escapeHtml(state.forms.seller.documentUrl)}" oninput="update('forms.seller.documentUrl', this.value)" /></label>
          <label class="span-2"><span>Seller address</span><textarea rows="3" oninput="update('forms.seller.sellerAddress', this.value)">${escapeHtml(state.forms.seller.sellerAddress)}</textarea></label>
          <div class="span-2 row"><button class="btn" type="submit">Save seller profile</button>${state.sellerProfile?.document_url ? `<a class="btn-outline" href="${escapeHtml(state.sellerProfile.document_url)}" target="_blank" rel="noreferrer">Open KYC doc</a>` : ''}</div>
        </form>
      </div>
      <div class="stack sticky">
        <div class="card">${sellerSummaryCard()}</div>
      </div>
      <div class="card stack">
        <div class="eyebrow">Seller approvals</div>
        <div class="stack">${state.users.filter(u => u.role === 'seller').map(user => `<div class="mini-card"><div class="inline-split"><strong>${escapeHtml(user.business_name || user.name)}</strong><span class="${user.is_verified ? 'verified' : 'pending-badge'}">${user.is_verified ? 'Verified' : labelize(user.kyc_status || 'pending')}</span></div><div class="muted">License: ${escapeHtml(user.license_number || '-')} · GST: ${escapeHtml(user.gst_number || '-')}</div><div class="muted">UPI: ${escapeHtml(user.upi_id || '-')} · Area: ${escapeHtml(user.service_area || '-')}</div><div class="row"><button class="btn-outline" onclick="approveSeller(${user.id}, true)">Approve</button><button class="btn-danger" onclick="approveSeller(${user.id}, false)">Reject</button>${user.document_url ? `<a class=\"btn-secondary\" href=\"${escapeHtml(user.document_url)}\" target=\"_blank\" rel=\"noreferrer\">KYC doc</a>` : ''}</div></div>`).join('') || `<div class="empty">No sellers found.</div>`}</div>
      </div>
    </section>
  `;
}

function renderBrowse() {
  return `<section class="stack"><div class="inline-split"><div class="tabs">${['all','fertilizer','vegetable'].map(category => `<button class="${state.filterCategory === category ? 'active' : ''}" onclick="setCategory('${category}')">${labelize(category)}</button>`).join('')}</div><div class="muted">${state.products.length} items</div></div><div class="product-grid">${state.products.map(productCard).join('') || `<div class="empty">No products found.</div>`}</div></section>`;
}

function renderCheckout() {
  const quote = cartQuoteSync();
  const paymentPills = state.paymentMethods.length ? state.paymentMethods : [
    { code: 'cod', label: 'Cash on delivery', live: true },
    { code: 'upi', label: 'UPI transfer', live: true },
    { code: 'scanpay', label: 'Scan & Pay QR', live: true }
  ];
  return `
    <section class="dashboard-grid">
      <div class="card stack">
        <div class="inline-split"><div><div class="eyebrow">Cart</div><h3 style="margin:8px 0 6px">Review your order</h3></div><button class="btn-secondary" onclick="setPage('browse')">Add more items</button></div>
        ${state.cart.length ? state.cart.map(cartCard).join('') : `<div class="empty">Your cart is empty.</div>`}
      </div>
      <div class="stack sticky">
        <div class="card stack">
          <div><div class="eyebrow">Checkout</div><h3 style="margin:8px 0 6px">Simple payment and address flow</h3></div>
          <label><span>Delivery address</span><textarea rows="3" oninput="update('forms.checkout.address', this.value)">${escapeHtml(state.forms.checkout.address)}</textarea></label>
          <label><span>Order note</span><textarea rows="3" oninput="update('forms.checkout.note', this.value)">${escapeHtml(state.forms.checkout.note)}</textarea></label>
          <div><div style="font-weight:700;margin-bottom:10px">Payment method</div><div class="payment-options">${paymentPills.map(item => `<button class="pill ${state.forms.checkout.paymentMethod === item.code ? 'active' : ''}" onclick="setPaymentMethod('${item.code}')">${escapeHtml(item.label)}</button>`).join('')}</div></div>
          ${quote ? billHtml(quote) : '<div class="empty">Add items to preview the bill.</div>'}
          ${state.forms.checkout.paymentMethod === 'upi' ? `<div class="footer-note">Use UPI payment after placing the order. You can mark payment complete from the order card.</div>` : ''}
          ${state.forms.checkout.paymentMethod === 'scanpay' ? `<div class="footer-note">Scan & Pay uses the QR/UPI payload returned by the payment provider.</div>` : ''}
          <button class="btn" ${state.cart.length ? '' : 'disabled'} onclick="placeOrder()">Place order</button>
        </div>
      </div>
      <div class="card stack">
        <div class="eyebrow">Seller approvals</div>
        <div class="stack">${state.users.filter(u => u.role === 'seller').map(user => `<div class="mini-card"><div class="inline-split"><strong>${escapeHtml(user.business_name || user.name)}</strong><span class="${user.is_verified ? 'verified' : 'pending-badge'}">${user.is_verified ? 'Verified' : labelize(user.kyc_status || 'pending')}</span></div><div class="muted">License: ${escapeHtml(user.license_number || '-')} · GST: ${escapeHtml(user.gst_number || '-')}</div><div class="muted">UPI: ${escapeHtml(user.upi_id || '-')} · Area: ${escapeHtml(user.service_area || '-')}</div><div class="row"><button class="btn-outline" onclick="approveSeller(${user.id}, true)">Approve</button><button class="btn-danger" onclick="approveSeller(${user.id}, false)">Reject</button>${user.document_url ? `<a class=\"btn-secondary\" href=\"${escapeHtml(user.document_url)}\" target=\"_blank\" rel=\"noreferrer\">KYC doc</a>` : ''}</div></div>`).join('') || `<div class="empty">No sellers found.</div>`}</div>
      </div>
    </section>
  `;
}

function renderOrders() {
  return `<section class="stack"><div class="order-grid">${filteredOrdersForPage().map(orderCard).join('') || `<div class="empty">No orders available.</div>`}</div></section>`;
}

function renderTracking() {
  const order = getCurrentTrackedOrder();
  return `
    <section class="tracking-layout">
      <div class="card stack tracking-main-card">
        <div class="inline-split">
          <div>
            <div class="eyebrow">Live tracking</div>
            <h3 style="margin:8px 0 6px">Animated rider map panel</h3>
            <p class="muted">Free OpenStreetMap tiles with a moving rider, trip trail, pace, and live order state.</p>
          </div>
          ${order ? `<button class="btn-secondary" onclick="viewTracking(${order.id})">Following order #${order.id}</button>` : ''}
        </div>
        <div class="swiggy-map-shell">
          <div id="leaflet-map"></div>
          ${trackingPanel()}
        </div>
        ${state.user.role === 'delivery' ? deliveryTrackingControls() : ''}
      </div>
      <div class="stack">
        <div class="card compact">
          <div class="eyebrow">Track an order</div>
          <div class="stack">${filteredOrdersForPage().map(o => `<button class="btn-outline" onclick="viewTracking(${o.id})">Order #${o.id} · ${escapeHtml(o.status.replaceAll('_',' '))}</button>`).join('') || `<div class="empty">No trackable orders.</div>`}</div>
        </div>
        <div class="card compact">
          <div class="eyebrow">Free maps</div>
          <div class="footer-note">This version uses OpenStreetMap + Leaflet. No paid map key is needed for the animated rider panel.</div>
        </div>
      </div>
    </section>
  `;
}

function deliveryTrackingControls() {
  const runs = filteredOrdersForPage().filter(o => o.delivery_partner_id === state.user.id || state.user.role === 'admin');
  return `<div class="card compact" style="background:#f8fafc;box-shadow:none"><div class="inline-split"><strong>Delivery live share</strong><span class="muted">${state.liveShare.active ? 'Sharing active' : 'Sharing off'}</span></div><div class="row" style="margin-top:12px"><select onchange="state.liveShare.orderId = Number(this.value)"><option value="">Choose order</option>${runs.map(run => `<option value="${run.id}">Order #${run.id}</option>`).join('')}</select><button class="btn" onclick="if(state.liveShare.orderId) startLiveShare(state.liveShare.orderId)">Start live share</button><button class="btn-secondary" onclick="stopLiveShare()">Stop</button></div></div>`;
}

function renderCatalog() {
  return `
    <section class="dashboard-grid">
      <div class="card stack">
        <div class="inline-split"><div><div class="eyebrow">Catalog</div><h3 style="margin:8px 0 6px">Manage product list</h3></div><div class="tabs">${['all','fertilizer','vegetable'].map(category => `<button class="${state.filterCategory === category ? 'active' : ''}" onclick="setCategory('${category}')">${labelize(category)}</button>`).join('')}</div></div>
        <div class="product-grid">${state.products.map(productCard).join('') || `<div class="empty">No products in this catalog.</div>`}</div>
      </div>
      <div class="card stack sticky">
        <div><div class="eyebrow">Add product</div><h3 style="margin:8px 0 6px">Fast product entry</h3></div>
        <form class="form-grid" onsubmit="addProduct(event)">
          <label class="span-2"><span>Name</span><input required value="${escapeHtml(state.forms.product.name)}" oninput="update('forms.product.name', this.value)" /></label>
          <label><span>Category</span><select onchange="update('forms.product.category', this.value)"><option value="vegetable" ${state.forms.product.category === 'vegetable' ? 'selected' : ''}>Vegetable</option><option value="fertilizer" ${state.forms.product.category === 'fertilizer' ? 'selected' : ''}>Fertilizer</option></select></label>
          <label><span>Unit</span><input value="${escapeHtml(state.forms.product.unit)}" oninput="update('forms.product.unit', this.value)" /></label>
          <label><span>Price</span><input type="number" value="${escapeHtml(state.forms.product.price)}" oninput="update('forms.product.price', this.value)" /></label>
          <label><span>Stock</span><input type="number" value="${escapeHtml(state.forms.product.stock)}" oninput="update('forms.product.stock', this.value)" /></label>
          <label class="span-2"><span>Image URL</span><input value="${escapeHtml(state.forms.product.imageUrl)}" oninput="update('forms.product.imageUrl', this.value)" /></label>
          <label class="span-2"><span>Description</span><textarea rows="4" oninput="update('forms.product.description', this.value)">${escapeHtml(state.forms.product.description)}</textarea></label>
          <div class="span-2"><button class="btn" type="submit">Add product</button></div>
        </form>
      </div>
      <div class="card stack">
        <div class="eyebrow">Seller approvals</div>
        <div class="stack">${state.users.filter(u => u.role === 'seller').map(user => `<div class="mini-card"><div class="inline-split"><strong>${escapeHtml(user.business_name || user.name)}</strong><span class="${user.is_verified ? 'verified' : 'pending-badge'}">${user.is_verified ? 'Verified' : labelize(user.kyc_status || 'pending')}</span></div><div class="muted">License: ${escapeHtml(user.license_number || '-')} · GST: ${escapeHtml(user.gst_number || '-')}</div><div class="muted">UPI: ${escapeHtml(user.upi_id || '-')} · Area: ${escapeHtml(user.service_area || '-')}</div><div class="row"><button class="btn-outline" onclick="approveSeller(${user.id}, true)">Approve</button><button class="btn-danger" onclick="approveSeller(${user.id}, false)">Reject</button>${user.document_url ? `<a class=\"btn-secondary\" href=\"${escapeHtml(user.document_url)}\" target=\"_blank\" rel=\"noreferrer\">KYC doc</a>` : ''}</div></div>`).join('') || `<div class="empty">No sellers found.</div>`}</div>
      </div>
    </section>
  `;
}

function renderUsers() {
  if (state.user.role !== 'admin') return `<div class="empty">Only admin can view users.</div>`;
  const overview = state.adminOverview || {};
  return `<section class="stack"><div class="stats-grid"><div class="metric"><div class="label">Users</div><div class="value">${state.users.length}</div><div class="muted">All roles</div></div><div class="metric"><div class="label">Revenue</div><div class="value">${money(overview.revenue || 0)}</div><div class="muted">Paid and COD pending</div></div><div class="metric"><div class="label">Product groups</div><div class="value">${overview.products?.length || 0}</div><div class="muted">Category buckets</div></div><div class="metric"><div class="label">Order statuses</div><div class="value">${overview.orders?.length || 0}</div><div class="muted">Tracked states</div></div></div><div class="card stack"><div class="eyebrow">Users table</div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Business</th><th>License</th></tr></thead><tbody>${state.users.map(user => `<tr><td>${escapeHtml(user.name)}</td><td>${labelize(user.role)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.phone || '-')}</td><td>${escapeHtml(user.business_name || '-')}</td><td>${escapeHtml(user.license_number || '-')}</td></tr>`).join('')}</tbody></table></div></div></section>`;
}

function renderNotifications() {
  return `<section class="stack">${state.notifications.map(note => `<div class="mini-card"><div class="inline-split"><strong>${escapeHtml(note.title)}</strong><span class="muted">${fmtDate(note.created_at)}</span></div><div class="muted">${escapeHtml(note.body)}</div></div>`).join('') || `<div class="empty">No notifications yet.</div>`}</section>`;
}

function productCard(product) {
  const emoji = product.category === 'fertilizer' ? '🌱' : '🥕';
  const sellerControls = ['seller','admin'].includes(state.user.role) && (state.user.role === 'admin' || product.seller_id === state.user.id);
  return `<article class="product-card"><div class="thumb">${emoji}</div><div class="row"><span class="tag">${labelize(product.category)}</span><span class="tag">${Number(product.stock)} ${escapeHtml(product.unit)}</span></div><div><strong style="font-size:1.08rem">${escapeHtml(product.name)}</strong><div class="muted" style="margin-top:6px">${escapeHtml(product.description || 'No description added.')}</div></div><div class="inline-split"><div><div class="price">${money(product.price)}</div><div class="muted small">Seller: ${escapeHtml(product.seller_name || 'Unknown')}</div></div>${state.user.role === 'farmer' ? `<button class="btn" onclick='addToCart(${json(product)})'>Add</button>` : sellerControls ? `<button class="btn-danger" onclick="deleteProduct(${product.id})">Remove</button>` : ''}</div></article>`;
}

function cartCard(item) {
  return `<div class="mini-card"><div class="inline-split"><strong>${escapeHtml(item.product.name)}</strong><span class="tag">${money(item.product.price)} each</span></div><div class="inline-split"><div class="row"><button class="btn-outline" onclick="changeQty(${item.productId}, -1)">-</button><span>${item.quantity}</span><button class="btn-outline" onclick="changeQty(${item.productId}, 1)">+</button></div><strong>${money(item.quantity * Number(item.product.price))}</strong></div></div>`;
}

function orderCard(order) {
  const canSellerAct = state.user.role === 'seller' || state.user.role === 'admin';
  const canFarmerPay = state.user.role === 'farmer' || state.user.role === 'admin';
  const canDeliveryAct = state.user.role === 'delivery' || state.user.role === 'admin';
  return `
    <article class="order-card">
      <div class="inline-split"><div><strong>Order #${order.id}</strong><div class="muted small">${fmtDate(order.created_at)}</div></div><span class="status ${escapeHtml(order.status)}">${labelize(order.status)}</span></div>
      <div class="row"><span class="tag">${labelize(order.payment_method)}</span><span class="tag ${order.payment_status === 'paid' ? 'status paid' : 'status cod_pending'}">${labelize(order.payment_status)}</span></div>
      <div class="kv"><div><span class="muted">Farmer</span><strong>${escapeHtml(order.farmer_name)}</strong></div><div><span class="muted">Seller</span><strong>${escapeHtml(order.seller_name)}</strong></div><div><span class="muted">Rider</span><strong>${escapeHtml(order.delivery_partner_name || 'Unassigned')}</strong></div></div>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity} ${escapeHtml(item.unit)}</td><td>${money(item.line_total)}</td></tr>`).join('')}</tbody></table></div>
      ${billHtml(order)}
      <div class="muted">${escapeHtml(order.address)}</div>
      <div class="order-actions">
        <button class="btn-secondary" onclick="viewTracking(${order.id})">Track</button><button class="btn-outline" onclick="downloadInvoice(${order.id})">Invoice</button>
        ${canSellerAct ? `<button class="btn-outline" onclick="updateStatus(${order.id}, 'confirmed')">Confirm</button><button class="btn-outline" onclick="updateStatus(${order.id}, 'packed')">Pack</button><select onchange="assignRider(${order.id}, this.value)"><option value="">Assign rider</option>${state.riders.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select>` : ''}
        ${canDeliveryAct ? `<button class="btn-outline" onclick="acceptRun(${order.id})">Accept pickup</button><button class="btn-outline" onclick="updateStatus(${order.id}, 'in_transit')">In transit</button><button class="btn" onclick="updateStatus(${order.id}, 'delivered')">Delivered</button>` : ''}
        ${canFarmerPay && order.payment_method !== 'cod' && order.payment_status !== 'paid' ? `<button class="btn-secondary" onclick="createPaymentIntent(${order.id})">Get payment details</button><button class="btn" onclick="confirmPayment(${order.id})">Mark paid</button>` : ''}
        ${(state.user.role === 'farmer' || state.user.role === 'admin') && ['pending','confirmed'].includes(order.status) ? `<button class="btn-danger" onclick="updateStatus(${order.id}, 'cancelled')">Cancel</button>` : ''}
      </div>
    </article>
  `;
}


async function downloadInvoice(orderId) {
  try {
    const invoice = await api(`/orders/${orderId}/invoice`);
    const content = JSON.stringify(invoice, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${invoice.invoiceNumber || `invoice-${orderId}`}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) { setFlash('', error.message); }
}

async function approveSeller(userId, isApproved) {
  try {
    await api(`/admin/sellers/${userId}/verify`, { method: 'PATCH', body: JSON.stringify({ isVerified: isApproved, kycStatus: isApproved ? 'approved' : 'rejected' }) });
    await maybeLoadAdmin();
    setFlash(`Seller ${isApproved ? 'approved' : 'rejected'}.`, '');
  } catch (error) { setFlash('', error.message); }
}

function trackingPanel() {
  const order = getCurrentTrackedOrder();
  if (!order) return `<div class="tracking-overlay-card"><div class="empty">Open an order to view tracking.</div></div>`;
  const point = order.latestTracking;
  const metrics = buildTripMetrics(order, state.trackingPoints);
  return `
    <div class="tracking-overlay-card">
      <div class="tracking-topbar">
        <div>
          <div class="tracking-order-label">Order #${order.id}</div>
          <div class="tracking-order-sub">${escapeHtml(order.delivery_partner_name || 'Waiting for rider assignment')}</div>
        </div>
        <span class="tracking-status-chip status ${escapeHtml(order.status)}">${labelize(order.status)}</span>
      </div>
      <div class="tracking-stage-strip">
        ${['confirmed','packed','assigned','picked_up','in_transit','delivered'].map(stage => `<span class="${metrics.activeStages.includes(stage) ? 'active' : ''}">${labelize(stage)}</span>`).join('')}
      </div>
      <div class="tracking-hero-metrics">
        <div class="hero-metric-card">
          <div class="hero-metric-label">ETA</div>
          <div class="hero-metric-value">${escapeHtml(metrics.etaText)}</div>
          <div class="hero-metric-sub">${escapeHtml(metrics.distanceLabel)}</div>
        </div>
        <div class="hero-metric-card">
          <div class="hero-metric-label">Ride pace</div>
          <div class="hero-metric-value">${escapeHtml(metrics.speedText)}</div>
          <div class="hero-metric-sub">${metrics.pointsCount} live points</div>
        </div>
        <div class="hero-metric-card">
          <div class="hero-metric-label">Last update</div>
          <div class="hero-metric-value">${escapeHtml(metrics.updatedText)}</div>
          <div class="hero-metric-sub">${point ? `${Number(point.latitude).toFixed(4)}, ${Number(point.longitude).toFixed(4)}` : 'Awaiting rider signal'}</div>
        </div>
      </div>
      <div class="tracking-bottom-row">
        <div class="tracking-pill"><span class="pill-dot"></span>${escapeHtml(order.payment_method.toUpperCase())} · ${escapeHtml(labelize(order.payment_status))}</div>
        <div class="tracking-pill muted">${escapeHtml(order.address)}</div>
      </div>
    </div>
  `;
}

function billHtml(source) {
  return `<div class="bill"><div class="bill-line"><span class="muted">Subtotal</span><strong>${money(source.subtotal)}</strong></div><div class="bill-line"><span class="muted">Delivery fee</span><strong>${money(source.delivery_fee ?? source.deliveryFee)}</strong></div><div class="bill-line"><span class="muted">Platform fee</span><strong>${money(source.platform_fee ?? source.platformFee)}</strong></div><div class="bill-line"><span class="muted">Tax</span><strong>${money(source.tax_amount ?? source.taxAmount)}</strong></div><div class="bill-line"><span class="muted">Discount</span><strong>- ${money(source.discount_amount ?? source.discountAmount ?? 0)}</strong></div><div class="bill-line total"><span>Total</span><span>${money(source.total)}</span></div></div>`;
}

function cartQuoteSync() {
  if (!state.cart.length) return null;
  const items = state.cart.map(item => ({ price: Number(item.product.price), quantity: item.quantity }));
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const deliveryFee = subtotal >= 1000 ? 0 : itemCount <= 3 ? 35 : 55;
  const platformFee = subtotal > 0 ? 12 : 0;
  const taxAmount = Number((subtotal * 0.02).toFixed(2));
  const discountAmount = subtotal >= 2500 ? 120 : 0;
  const total = Number((subtotal + deliveryFee + platformFee + taxAmount - discountAmount).toFixed(2));
  return { subtotal, deliveryFee, platformFee, taxAmount, discountAmount, total };
}


function setupMap() {
  const container = document.getElementById('leaflet-map');
  if (!container || typeof L === 'undefined') return;
  if (!state.map) {
    state.map = L.map(container, { zoomControl: false, attributionControl: true }).setView([13.0827, 80.2707], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(state.map);
    L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  } else {
    setTimeout(() => state.map.invalidateSize(), 60);
  }
  renderMapScene();
}

function renderMapScene() {
  if (!state.map) return;
  const order = getCurrentTrackedOrder();
  const points = getMapPoints(order);
  if (!points.length) return;
  const latest = points[points.length - 1];
  const start = points[0];
  if (!state.mapTrailGlow) {
    state.mapTrailGlow = L.polyline(points, { color: '#fb923c', weight: 10, opacity: 0.18, lineCap: 'round', lineJoin: 'round' }).addTo(state.map);
  } else {
    state.mapTrailGlow.setLatLngs(points);
  }
  if (!state.mapTrailLine) {
    state.mapTrailLine = L.polyline(points, { color: '#16a34a', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', dashArray: '10 14' }).addTo(state.map);
  } else {
    state.mapTrailLine.setLatLngs(points);
  }
  if (!state.mapPickupMarker) {
    state.mapPickupMarker = L.marker(start, { icon: buildBadgeIcon('Pickup', 'pickup-badge') }).addTo(state.map);
  } else {
    state.mapPickupMarker.setLatLng(start);
  }
  const pseudoDrop = deriveDropPoint(order, latest);
  if (!state.mapDropMarker) {
    state.mapDropMarker = L.marker(pseudoDrop, { icon: buildBadgeIcon('Drop', 'drop-badge') }).addTo(state.map);
  } else {
    state.mapDropMarker.setLatLng(pseudoDrop);
  }
  ensureRiderMarker(latest, Number(order.latestTracking?.heading || 0));
  if (!state.mapFocusBoundsDone) {
    const bounds = L.latLngBounds([start, latest, pseudoDrop]);
    state.map.fitBounds(bounds.pad(0.28), { animate: true });
    state.mapFocusBoundsDone = true;
  } else {
    state.map.panTo(latest, { animate: true, duration: 0.8 });
  }
}

function ensureRiderMarker(latlng, heading = 0) {
  if (!state.mapMarker) {
    state.mapMarker = L.marker(latlng, { icon: buildRiderIcon(heading) }).addTo(state.map);
    state.mapMarker.bindTooltip('Rider live', { direction: 'top', offset: [0, -20] });
    updateRiderMarkerHeading(heading);
    return;
  }
  animateMarkerTo(state.mapMarker, latlng, 900, () => updateRiderMarkerHeading(heading));
}

function animateMarkerTo(marker, target, duration = 800, done) {
  if (!marker) return;
  if (state.riderAnimationFrame) cancelAnimationFrame(state.riderAnimationFrame);
  const start = marker.getLatLng();
  const end = L.latLng(target[0], target[1]);
  const startTime = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const next = L.latLng(
      start.lat + (end.lat - start.lat) * eased,
      start.lng + (end.lng - start.lng) * eased
    );
    marker.setLatLng(next);
    if (t < 1) state.riderAnimationFrame = requestAnimationFrame(frame);
    else {
      state.riderAnimationFrame = null;
      if (done) done();
    }
  }
  state.riderAnimationFrame = requestAnimationFrame(frame);
}

function buildRiderIcon(heading = 0) {
  return L.divIcon({
    className: 'rider-div-icon',
    html: `<div class="rider-marker-wrap"><span class="rider-pulse-ring"></span><span class="rider-bike-chip" style="transform: rotate(${heading}deg)">🛵</span></div>`,
    iconSize: [52, 52],
    iconAnchor: [26, 26]
  });
}

function buildBadgeIcon(label, className) {
  return L.divIcon({
    className: 'map-badge-icon',
    html: `<div class="map-badge ${className}">${label}</div>`,
    iconSize: [72, 28],
    iconAnchor: [36, 14]
  });
}

function updateRiderMarkerHeading(heading = 0) {
  const bike = state.mapMarker?.getElement()?.querySelector('.rider-bike-chip');
  if (bike) bike.style.transform = `rotate(${Number(heading || 0)}deg)`;
}

function getMapPoints(order) {
  const points = state.trackingPoints.map((point) => [Number(point.latitude), Number(point.longitude)]).filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (points.length) return points;
  const latest = order?.latestTracking;
  return latest ? [[Number(latest.latitude), Number(latest.longitude)]] : [];
}

function deriveDropPoint(order, latestPoint) {
  const baseLat = Number(latestPoint[0]);
  const baseLng = Number(latestPoint[1]);
  const seed = Number(order?.id || 1);
  const latOffset = (((seed % 7) + 2) / 1000) * (seed % 2 === 0 ? 1 : -1);
  const lngOffset = (((seed % 5) + 3) / 1000) * (seed % 3 === 0 ? -1 : 1);
  return [baseLat + latOffset, baseLng + lngOffset];
}

function buildTripMetrics(order, trackingPoints) {
  const points = (trackingPoints || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const latest = order?.latestTracking || points[points.length - 1];
  const speedMs = Number(latest?.speed || 0);
  const speedKmh = speedMs > 0 ? speedMs * 3.6 : 18;
  let coveredKm = 0;
  for (let i = 1; i < points.length; i += 1) {
    coveredKm += haversineKm(points[i - 1], points[i]);
  }
  let remainingKm = 2.8;
  if (order?.status === 'picked_up') remainingKm = Math.max(0.8, 2.0 - coveredKm);
  if (order?.status === 'in_transit') remainingKm = Math.max(0.3, 1.4 - coveredKm);
  if (order?.status === 'delivered') remainingKm = 0;
  const etaMin = remainingKm <= 0 ? 0 : Math.max(2, Math.round((remainingKm / Math.max(speedKmh, 12)) * 60));
  const updatedText = latest?.created_at ? timeAgo(latest.created_at) : 'Waiting';
  const activeStages = ['confirmed','packed','assigned','picked_up','in_transit','delivered'].filter((stage) => stageOrder(stage) <= stageOrder(order?.status || 'pending'));
  return {
    pointsCount: points.length || (latest ? 1 : 0),
    speedText: `${Math.round(speedKmh)} km/h`,
    etaText: remainingKm <= 0 ? 'Arrived' : `${etaMin} min`,
    distanceLabel: coveredKm > 0 ? `${coveredKm.toFixed(2)} km trail` : 'Live rider stream',
    updatedText,
    activeStages
  };
}

function stageOrder(status) {
  return ['pending','confirmed','packed','assigned','picked_up','in_transit','delivered','cancelled'].indexOf(status);
}

function haversineKm(a, b) {
  const aLat = Number(a.latitude ?? a[0]);
  const aLng = Number(a.longitude ?? a[1]);
  const bLat = Number(b.latitude ?? b[0]);
  const bLng = Number(b.longitude ?? b[1]);
  const rad = (deg) => deg * Math.PI / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function timeAgo(value) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} hr ago`;
}

function updateMap(point) {
  if (!state.map || !point) return;
  renderMapScene();
}

function filteredOrdersForPage() { return state.orders; }
function money(value) { return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`; }
function fmtDate(value) { return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
function labelize(value) { return String(value).replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase()); }
function json(obj) { return escapeHtml(JSON.stringify(obj)); }
function escapeHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

window.update = update;
window.submitAuth = submitAuth;
window.saveSellerProfile = saveSellerProfile;
window.setAuthMode = (mode) => { state.authMode = mode; state.flash = { ok: '', error: '' }; render(); };
window.setAuthRole = (role) => { state.authRole = role; state.flash = { ok: '', error: '' }; render(); };
window.setPage = async (page) => { state.page = page; if (['catalog','browse','profile'].includes(page)) { await loadProducts(); if (page === 'profile') await maybeLoadSellerProfile(); } if (page === 'tracking') { const order = getCurrentTrackedOrder(); if (order) await loadTracking(order.id); } render(); };
window.setCategory = async (category) => { state.filterCategory = category; await loadProducts(); render(); };
window.setPaymentMethod = (method) => { state.forms.checkout.paymentMethod = method; render(); };
window.logout = logout;
window.refreshNow = async () => { await hydrate(); render(); };
window.addProduct = addProduct;
window.deleteProduct = deleteProduct;
window.addToCart = addToCart;
window.changeQty = changeQty;
window.placeOrder = placeOrder;
window.updateStatus = updateStatus;
window.assignRider = assignRider;
window.acceptRun = acceptRun;
window.createPaymentIntent = createPaymentIntent;
window.confirmPayment = confirmPayment;
window.viewTracking = viewTracking;
window.startLiveShare = startLiveShare;
window.stopLiveShare = stopLiveShare;

window.downloadInvoice = downloadInvoice;
window.approveSeller = approveSeller;
