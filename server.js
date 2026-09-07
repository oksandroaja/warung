const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "waroengsandro.db");

// Railway Volume dapat dipasang ke /data agar database tetap tersimpan saat deploy ulang.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
const JWT_SECRET = process.env.JWT_SECRET || "ganti-secret-key-ini";
const ADMIN_EMAIL = "sicantik.109888@gmail.com";
const LEGACY_ADMIN_EMAIL = "admin@waroengsandro.id";

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    admin INTEGER DEFAULT 0,
    debt INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    category TEXT DEFAULT 'Produk',
    emoji TEXT DEFAULT '🛒',
    image TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    items TEXT NOT NULL,
    total INTEGER NOT NULL,
    payment TEXT NOT NULL,
    note TEXT DEFAULT '',
    date TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

const legacyAdmin = db
  .prepare("SELECT id FROM users WHERE email = ?")
  .get(LEGACY_ADMIN_EMAIL);
const adminExists = db
  .prepare("SELECT id FROM users WHERE email = ?")
  .get(ADMIN_EMAIL);

if (legacyAdmin && !adminExists) {
  db.prepare("UPDATE users SET email = ?, admin = 1 WHERE id = ?").run(
    ADMIN_EMAIL,
    legacyAdmin.id,
  );
} else if (!adminExists) {
  const password = bcrypt.hashSync("admin123", 10);

  db.prepare(
    `
    INSERT INTO users (name, email, password, admin)
    VALUES (?, ?, ?, 1)
  `,
  ).run("Admin WaroengSandro", ADMIN_EMAIL, password);
}

const productCount = db
  .prepare("SELECT COUNT(*) AS total FROM products")
  .get().total;

if (!productCount) {
  const products = [
    ["Beras Premium 5kg", 75000, 12, "Sembako", "🍚", ""],
    ["Minyak Goreng 1L", 19000, 20, "Sembako", "🫗", ""],
    ["Kopi Bubuk Sandro", 28000, 15, "Minuman", "☕", ""],
    ["Mi Instan Goreng", 3500, 40, "Makanan", "🍜", ""],
    ["Telur Ayam 1kg", 30000, 10, "Sembako", "🥚", ""],
    ["Teh Celup", 12000, 25, "Minuman", "🍵", ""],
  ];

  const insert = db.prepare(`
    INSERT INTO products
    (name, price, stock, category, emoji, image)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(...row);
  });

  insertMany(products);
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      admin: Boolean(user.admin),
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ message: "Token login tidak ditemukan." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res
      .status(401)
      .json({ message: "Token login tidak valid atau sudah expired." });
  }
}

function adminOnly(req, res, next) {
  if (!req.user.admin) {
    return res.status(403).json({ message: "Akses admin diperlukan." });
  }

  next();
}

app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body;

  if (!name || name.trim().length < 3) {
    return res.status(400).json({ message: "Nama asli minimal 3 karakter." });
  }

  if (!email || !password || password.length < 6) {
    return res.status(400).json({ message: "Email dan password tidak valid." });
  }

  const exists = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email.toLowerCase());

  if (exists) {
    return res.status(409).json({ message: "Email sudah terdaftar." });
  }

  const hash = bcrypt.hashSync(password, 10);

  const result = db
    .prepare(
      `
    INSERT INTO users (name, email, password)
    VALUES (?, ?, ?)
  `,
    )
    .run(name.trim(), email.toLowerCase(), hash);

  const user = db
    .prepare("SELECT id, name, email, admin, debt FROM users WHERE id = ?")
    .get(result.lastInsertRowid);

  res.status(201).json({
    message: "Akun berhasil dibuat.",
    user,
    token: createToken(user),
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;

  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(String(email || "").toLowerCase());

  if (!user || !bcrypt.compareSync(password || "", user.password)) {
    return res.status(401).json({ message: "Email atau password salah." });
  }

  const safeUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    admin: Boolean(user.admin),
    debt: user.debt,
  };

  res.json({
    user: safeUser,
    token: createToken(safeUser),
  });
});

app.get("/api/products", auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all());
});

app.post("/api/products", auth, adminOnly, (req, res) => {
  const { name, price, stock, category, emoji, image } = req.body;

  if (!name || Number(price) < 0 || Number(stock) < 0) {
    return res.status(400).json({ message: "Data produk tidak valid." });
  }

  const result = db
    .prepare(
      `
    INSERT INTO products (name, price, stock, category, emoji, image)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      name.trim(),
      Number(price),
      Number(stock),
      category || "Produk",
      emoji || "🛒",
      image || "",
    );

  res
    .status(201)
    .json(
      db
        .prepare("SELECT * FROM products WHERE id = ?")
        .get(result.lastInsertRowid),
    );
});

app.put("/api/products/:id", auth, adminOnly, (req, res) => {
  const { name, price, stock, category, emoji, image } = req.body;

  const result = db
    .prepare(
      `
    UPDATE products
    SET name = ?, price = ?, stock = ?, category = ?, emoji = ?, image = ?
    WHERE id = ?
  `,
    )
    .run(
      name.trim(),
      Number(price),
      Number(stock),
      category || "Produk",
      emoji || "🛒",
      image || "",
      req.params.id,
    );

  if (!result.changes) {
    return res.status(404).json({ message: "Produk tidak ditemukan." });
  }

  res.json({ message: "Produk berhasil diperbarui." });
});

app.delete("/api/products/:id", auth, adminOnly, (req, res) => {
  const result = db
    .prepare("DELETE FROM products WHERE id = ?")
    .run(req.params.id);

  if (!result.changes) {
    return res.status(404).json({ message: "Produk tidak ditemukan." });
  }

  res.json({ message: "Produk berhasil dihapus." });
});

app.post("/api/orders", auth, (req, res) => {
  const { items, payment, note } = req.body;

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: "Pesanan tidak memiliki produk." });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);

  const transaction = db.transaction(() => {
    let total = 0;
    const finalItems = [];

    for (const item of items) {
      const quantity = Number(item.qty);
      const product = db
        .prepare("SELECT * FROM products WHERE id = ?")
        .get(Number(item.id));

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error("Jumlah produk tidak valid.");
      }

      if (!product || product.stock < quantity) {
        throw new Error(`Stok ${product?.name || "produk"} tidak mencukupi.`);
      }

      total += product.price * item.qty;

      finalItems.push({
        id: product.id,
        name: product.name,
        qty: item.qty,
        price: product.price,
      });

      db.prepare(
        `
        UPDATE products SET stock = stock - ? WHERE id = ?
      `,
      ).run(item.qty, product.id);
    }

    const number = "WS-" + Date.now().toString().slice(-8);
    const date = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO orders
      (number, user_id, email, name, items, total, payment, note, date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      number,
      user.id,
      user.email,
      user.name,
      JSON.stringify(finalItems),
      total,
      payment || "cod",
      note || "",
      date,
    );

    if (payment === "debt") {
      db.prepare(
        `
        UPDATE users SET debt = debt + ? WHERE id = ?
      `,
      ).run(total, user.id);
    }

    return {
      number,
      email: user.email,
      name: user.name,
      items: finalItems,
      total,
      payment: payment || "cod",
      note: note || "",
      date,
    };
  });

  try {
    res.status(201).json(transaction());
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get("/api/orders", auth, (req, res) => {
  const query = req.user.admin
    ? "SELECT * FROM orders ORDER BY id DESC"
    : "SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC";

  const rows = req.user.admin
    ? db.prepare(query).all()
    : db.prepare(query).all(req.user.id);

  res.json(
    rows.map((order) => ({
      ...order,
      items: JSON.parse(order.items),
    })),
  );
});

app.get("/api/users", auth, adminOnly, (req, res) => {
  res.json(
    db
      .prepare(
        `
      SELECT id, name, email, admin, debt, created_at
      FROM users
      ORDER BY id DESC
    `,
      )
      .all(),
  );
});

app.patch("/api/users/:id/name", auth, (req, res) => {
  if (req.user.id !== Number(req.params.id) && !req.user.admin) {
    return res.status(403).json({ message: "Tidak memiliki akses." });
  }

  const name = String(req.body.name || "").trim();

  if (name.length < 3) {
    return res.status(400).json({ message: "Nama asli minimal 3 karakter." });
  }

  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, req.params.id);

  res.json({ message: "Nama berhasil diperbarui." });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
