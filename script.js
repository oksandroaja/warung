const API = "/api";
const get = key => JSON.parse(localStorage.getItem(key) || "null");
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

let products = [];
let users = [];
let orders = [];
let cart = get("ws_cart") || [];
let currentUser = get("ws_currentUser");
let token = localStorage.getItem("ws_token");
let registerMode = false;

const rupiah = n => new Intl.NumberFormat("id-ID", {
  style: "currency", currency: "IDR", maximumFractionDigits: 0
}).format(n);

const esc = value => String(value ?? "").replace(/[&<>"']/g, x => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
}[x]));
const $ = id => document.getElementById(id);

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Terjadi kesalahan pada server.");
  return data;
}

async function startApp() {
  if (!currentUser || !token) return;
  try {
    [products, orders] = await Promise.all([api("/products"), api("/orders")]);
    if (currentUser.admin) users = await api("/users");
  } catch (error) {
    toast(error.message);
    return;
  }

  $("authPage").classList.add("hidden");
  $("appPage").classList.remove("hidden");
  document.querySelectorAll(".admin-only").forEach(x => x.classList.toggle("hidden", !currentUser.admin));
  renderProducts(); renderCart(); renderOrders(); renderAdmin();
  if (!currentUser.admin && !currentUser.name) $("nameModal").classList.remove("hidden");
}

function renderProducts() {
  const query = ($("searchProduct").value || "").toLowerCase();
  const list = products.filter(p => p.name.toLowerCase().includes(query));
  $("productGrid").innerHTML = list.length ? list.map(p => `
    <article class="product-card">
      <div class="product-image" ${p.image ? `style="background-image:url('${esc(p.image)}')"` : ""}>${p.image ? "" : p.emoji || "🛒"}</div>
      <div class="product-info"><small class="product-category">${esc(p.category || "Produk")}</small>
        <h3>${esc(p.name)}</h3><div class="product-bottom"><div><div class="price">${rupiah(p.price)}</div>
        <small class="muted">Stok ${p.stock}</small></div><button class="add-btn" onclick="addToCart(${p.id})" ${p.stock < 1 ? "disabled" : ""}>＋</button></div>
      </div>
    </article>`).join("") : `<p class="muted">Produk tidak ditemukan.</p>`;
}

function addToCart(id) {
  const product = products.find(p => p.id === id), item = cart.find(x => x.id === id);
  if (!product || product.stock < (item?.qty || 0) + 1) return toast("Stok produk tidak mencukupi.");
  item ? item.qty++ : cart.push({ id, qty: 1 });
  save("ws_cart", cart); renderCart(); toast("Produk masuk ke keranjang.");
}

function renderCart() {
  const detailed = cart.map(item => ({ ...item, product: products.find(p => p.id === item.id) })).filter(x => x.product);
  $("cartCount").textContent = detailed.reduce((a, x) => a + x.qty, 0);
  $("cartItems").innerHTML = detailed.length ? detailed.map(x => `
    <div class="cart-row"><div class="drawer-head"><h3>${esc(x.product.name)}</h3><strong>${rupiah(x.product.price * x.qty)}</strong></div>
    <div class="qty"><button onclick="changeQty(${x.id},-1)">−</button> ${x.qty} <button onclick="changeQty(${x.id},1)">＋</button></div></div>`).join("") : `<p class="muted">Keranjang masih kosong.</p>`;
  $("cartTotal").textContent = rupiah(detailed.reduce((a, x) => a + x.product.price * x.qty, 0));
}

function changeQty(id, amount) {
  const item = cart.find(x => x.id === id), product = products.find(p => p.id === id);
  if (!item || !product) return;
  item.qty += amount;
  if (item.qty <= 0) cart = cart.filter(x => x.id !== id);
  if (item.qty > product.stock) item.qty = product.stock;
  save("ws_cart", cart); renderCart();
}

function renderOrders() {
  const mine = orders.filter(o => currentUser.admin || o.email === currentUser.email);
  $("myOrders").innerHTML = mine.length ? mine.map(orderHTML).join("") : `<div class="panel"><p class="muted">Belum ada pesanan. Yuk mulai belanja!</p></div>`;
}
function orderHTML(o) { return `<div class="order-card"><div class="order-head"><div><small class="muted">NOMOR PESANAN</small><h3>${esc(o.number)}</h3></div>
  <span class="badge ${o.payment === "debt" ? "debt" : ""}">${o.payment === "debt" ? "Hutang" : "Bayar di tempat"}</span></div>
  <p><b>Pemesan:</b> ${esc(o.name || "Nama belum tersedia")}</p><p class="muted">${new Date(o.date).toLocaleString("id-ID")} · ${esc(o.email)}</p>
  <p>${o.items.map(i => `${esc(i.name)} × ${i.qty}`).join(", ")}</p><strong class="price">${rupiah(o.total)}</strong></div>`; }

function renderAdmin() {
  if (!currentUser?.admin) return;
  $("statOrders").textContent = orders.length; $("statUsers").textContent = users.length; $("statProducts").textContent = products.length;
  $("statDebt").textContent = rupiah(orders.filter(o => o.payment === "debt").reduce((a, o) => a + o.total, 0));
  $("allOrders").innerHTML = orders.length ? orders.map(orderHTML).join("") : `<p class="muted">Belum ada pesanan.</p>`;
  $("allUsers").innerHTML = users.length ? users.map(u => `<div><b>${esc(u.name || "Nama belum diisi")}</b><br><small class="muted">${esc(u.email)} · Hutang: ${rupiah(u.debt || 0)}</small></div>`).join("") : `<p class="muted">Belum ada pembeli.</p>`;
  $("adminProducts").innerHTML = products.map(p => `<div class="inventory-row">${p.image ? `<img src="${esc(p.image)}">` : `<span style="font-size:30px">${p.emoji || "🛒"}</span>`}<div class="inventory-info"><b>${esc(p.name)}</b><br><small class="muted">${rupiah(p.price)} · Stok ${p.stock}</small></div><button class="small-btn" onclick="editProduct(${p.id})">Edit</button><button class="small-btn danger" onclick="deleteProduct(${p.id})">Hapus</button></div>`).join("");
}

$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const body = { name: $("authName").value.trim(), email: $("authEmail").value.trim(), password: $("authPassword").value };
  try {
    const data = await api(registerMode ? "/auth/register" : "/auth/login", { method: "POST", body: JSON.stringify(body) });
    if (registerMode) { toast("Akun berhasil dibuat."); toggleAuth(); return; }
    currentUser = data.user; token = data.token; save("ws_currentUser", currentUser); localStorage.setItem("ws_token", token); startApp();
  } catch (error) { toast(error.message); }
});

function toggleAuth() {
  registerMode = !registerMode; $("authTitle").textContent = registerMode ? "Buat akun baru" : "Selamat datang kembali";
  $("authSubtitle").textContent = registerMode ? "Daftar untuk mulai berbelanja." : "Login untuk mulai berbelanja.";
  $("authButton").textContent = registerMode ? "Daftar Sekarang" : "Masuk ke Waroeng";
  $("switchText").textContent = registerMode ? "Sudah punya akun?" : "Belum punya akun?"; $("switchAuth").textContent = registerMode ? "Masuk di sini" : "Daftar sekarang";
  $("authNameLabel").classList.toggle("hidden", !registerMode); $("authName").required = registerMode;
}
$("switchAuth").onclick = toggleAuth;

$("nameForm").onsubmit = async e => { e.preventDefault(); const name = $("accountName").value.trim(); if (name.length < 3) return toast("Nama asli minimal 3 karakter.");
  try { await api(`/users/${currentUser.id}/name`, { method: "PATCH", body: JSON.stringify({ name }) }); currentUser.name = name; save("ws_currentUser", currentUser); $("nameModal").classList.add("hidden"); toast("Nama akun berhasil disimpan."); } catch (error) { toast(error.message); }
};
$("logoutButton").onclick = () => { localStorage.removeItem("ws_currentUser"); localStorage.removeItem("ws_token"); location.reload(); };
$("searchProduct").oninput = renderProducts;

document.querySelectorAll(".nav-btn").forEach(btn => btn.onclick = () => { document.querySelectorAll(".nav-btn").forEach(x => x.classList.remove("active")); btn.classList.add("active"); document.querySelectorAll(".page").forEach(x => x.classList.add("hidden")); $(btn.dataset.page).classList.remove("hidden"); if (btn.dataset.page === "adminPage") renderAdmin(); });
function openCart() { $("cartDrawer").classList.add("open"); $("overlay").classList.add("show"); }
function closeCart() { $("cartDrawer").classList.remove("open"); $("overlay").classList.remove("show"); }
$("cartButton").onclick = openCart; $("closeCart").onclick = closeCart; $("overlay").onclick = closeCart;
$("checkoutButton").onclick = () => { if (!cart.length) return toast("Keranjang masih kosong."); $("checkoutSummary").innerHTML = `<p><b>Pemesan:</b> ${esc(currentUser.name || "Nama belum tersedia")}</p><p class="muted">${cart.reduce((a, x) => a + x.qty, 0)} barang dipilih · ${$("cartTotal").textContent}</p>`; $("checkoutModal").classList.remove("hidden"); };

$("confirmOrder").onclick = async () => {
  try {
    const data = await api("/orders", { method: "POST", body: JSON.stringify({ items: cart, payment: $("paymentMethod").value, note: $("customerNote").value }) });
    cart = []; save("ws_cart", cart); $("checkoutModal").classList.add("hidden"); closeCart(); await startApp(); alert(`Pesanan berhasil dibuat!\nNomor pesanan: ${data.number}\nTunjukkan nomor ini ke kasir.`);
  } catch (error) { toast(error.message); await startApp(); }
};
document.querySelectorAll("[data-close]").forEach(btn => btn.onclick = () => $(btn.dataset.close).classList.add("hidden"));

$("addProductButton").onclick = () => { $("productForm").reset(); $("productId").value = ""; $("productModalTitle").textContent = "Tambah Produk"; $("productModal").classList.remove("hidden"); };
$("productForm").onsubmit = async e => { e.preventDefault(); const id = $("productId").value; const data = { name: $("productName").value.trim(), price: Number($("productPrice").value), stock: Number($("productStock").value), image: $("productImage").value.trim(), category: $("productCategory").value.trim() || "Produk", emoji: "🛒" };
  try { await api(id ? `/products/${id}` : "/products", { method: id ? "PUT" : "POST", body: JSON.stringify(data) }); $("productModal").classList.add("hidden"); await startApp(); toast("Produk berhasil disimpan."); } catch (error) { toast(error.message); }
};
function editProduct(id) { const p = products.find(x => x.id === id); $("productId").value = p.id; $("productName").value = p.name; $("productPrice").value = p.price; $("productStock").value = p.stock; $("productImage").value = p.image; $("productCategory").value = p.category; $("productModalTitle").textContent = "Edit Produk"; $("productModal").classList.remove("hidden"); }
async function deleteProduct(id) { if (!confirm("Hapus produk ini?")) return; try { await api(`/products/${id}`, { method: "DELETE" }); await startApp(); toast("Produk dihapus."); } catch (error) { toast(error.message); } }

startApp();