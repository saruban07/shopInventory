import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'db.json');
const MONGO_URI = process.env.MONGO_URI;
const SESSION_COOKIE = 'shop_session';
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'https://shop-inventory-gamma.vercel.app')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const isLocalDevOrigin = (origin) => {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
};

app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || isLocalDevOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
}));

const databaseSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  users: { type: Array, default: [] },
  sessions: { type: Object, default: {} },
}, { minimize: false });

const Database = mongoose.models.Database || mongoose.model('Database', databaseSchema);
let mongoReady = false;

const defaultDb = () => ({ users: [], sessions: {} });

const connectMongo = async () => {
  if (!MONGO_URI) {
    console.log('MONGO_URI not set. Using local db.json storage.');
    return;
  }

  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    mongoReady = true;
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection failed. Using local db.json storage.');
    console.error(error.message);
  }
};

const readDb = async () => {
  if (mongoReady) {
    const data = await Database.findOneAndUpdate(
      { key: 'main' },
      { $setOnInsert: defaultDb() },
      { new: true, upsert: true, lean: true }
    );
    return {
      users: data.users || [],
      sessions: data.sessions || {},
    };
  }

  const content = await fs.readFile(DB_FILE, 'utf8');
  return JSON.parse(content);
};

const writeDb = async (data) => {
  if (mongoReady) {
    await Database.updateOne(
      { key: 'main' },
      { $set: { users: data.users || [], sessions: data.sessions || {} } },
      { upsert: true }
    );
    return;
  }

  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
};

const getCurrentUser = async (req) => {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const db = await readDb();
  const userId = db.sessions[sessionId];
  if (!userId) return null;
  return db.users.find((user) => user.id === userId) || null;
};

const requireUser = async (req, res, next) => {
  const user = await getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ status: false, message: 'Unauthorized' });
  }
  req.user = user;
  next();
};

const createSession = async (res, userId) => {
  const db = await readDb();
  const sessionId = uuidv4();
  db.sessions[sessionId] = userId;
  await writeDb(db);
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
};

app.get('/api', (req, res) => {
  res.json({ status: true, message: 'Backend is running' });
});

app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ status: false, message: 'Email and password are required' });
  }

  const db = await readDb();
  const existing = db.users.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
  if (existing) {
    return res.json({ status: false, message: 'User already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    email: String(email).toLowerCase(),
    passwordHash,
    products: [],
    sales: [],
  };
  db.users.push(newUser);
  await writeDb(db);
  return res.json({ status: true, message: 'Registration successful' });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.json({ status: false, message: 'Email and password are required' });
  }

  const db = await readDb();
  const user = db.users.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
  if (!user) {
    return res.json({ status: false, message: 'Invalid credentials' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.json({ status: false, message: 'Invalid credentials' });
  }

  await createSession(res, user.id);
  return res.json({ status: true, message: 'Login successful' });
});

app.get('/api/logout', async (req, res) => {
  const sessionId = req.cookies[SESSION_COOKIE];
  if (sessionId) {
    const db = await readDb();
    delete db.sessions[sessionId];
    await writeDb(db);
    res.clearCookie(SESSION_COOKIE);
  }
  res.json({ status: true, message: 'Logged out' });
});

app.get('/api/getUser', requireUser, async (req, res) => {
  const user = req.user;
  res.json({ status: true, data: { email: user.email, products: user.products, sales: user.sales } });
});

app.get('/api/products', requireUser, async (req, res) => {
  const user = req.user;
  res.json({ status: true, data: user.products });
});

app.post('/api/insert', requireUser, async (req, res) => {
  const { p_name, p_price, p_stock } = req.body;
  if (!p_name || !p_price || !p_stock) {
    return res.json({ status: false, message: 'Missing product fields' });
  }

  const db = await readDb();
  const user = db.users.find((u) => u.id === req.user.id);
  const product = {
    _id: uuidv4(),
    p_name: String(p_name).trim(),
    p_price: Number(p_price),
    p_stock: Number(p_stock),
  };
  user.products.push(product);
  await writeDb(db);
  res.json({ status: true, message: 'Product added' });
});

app.post('/api/update', requireUser, async (req, res) => {
  const { productId, newdata } = req.body;
  if (!productId || !newdata) {
    return res.json({ status: false, message: 'Missing update data' });
  }

  const db = await readDb();
  const user = db.users.find((u) => u.id === req.user.id);
  const product = user.products.find((item) => item._id === productId);
  if (!product) {
    return res.json({ status: false, message: 'Product not found' });
  }

  product.p_name = String(newdata.p_name).trim();
  product.p_price = Number(newdata.p_price);
  product.p_stock = Number(newdata.p_stock);
  await writeDb(db);
  res.json({ status: true, message: 'Product updated' });
});

app.post('/api/delete', requireUser, async (req, res) => {
  const { productId } = req.body;
  if (!productId) {
    return res.json({ status: false, message: 'Missing productId' });
  }

  const db = await readDb();
  const user = db.users.find((u) => u.id === req.user.id);
  user.products = user.products.filter((item) => item._id !== productId);
  await writeDb(db);
  res.json({ status: true, message: 'Product removed' });
});

app.post('/api/createsales', requireUser, async (req, res) => {
  const { cust_name, cust_email, cust_contact, cartItems } = req.body;
  if (!cust_name || !cust_email || !cust_contact || !Array.isArray(cartItems) || cartItems.length === 0) {
    return res.json({ status: false, message: 'Invalid sale payload' });
  }

  const db = await readDb();
  const user = db.users.find((u) => u.id === req.user.id);
  const productMap = new Map(user.products.map((item) => [item._id, item]));

  for (const item of cartItems) {
    const product = productMap.get(item.c_id);
    if (!product) {
      return res.json({ status: false, message: `Product ${item.c_name} not found` });
    }
    const quantity = Number(item.c_quantity);
    if (quantity > product.p_stock) {
      return res.json({ status: false, message: `Not enough stock for ${item.c_name}` });
    }
  }

  cartItems.forEach((item) => {
    const product = productMap.get(item.c_id);
    product.p_stock = Number(product.p_stock) - Number(item.c_quantity);
  });

  const sale = {
    _id: uuidv4(),
    cust_name: String(cust_name).trim(),
    cust_email: String(cust_email).toLowerCase().trim(),
    cust_contact: String(cust_contact).trim(),
    cartItems: cartItems.map((item) => ({ ...item })),
    createdAt: new Date().toISOString(),
  };

  user.sales.push(sale);
  await writeDb(db);
  res.json({ status: true, message: 'Sale created' });
});

app.get('/api/getsales', requireUser, async (req, res) => {
  const user = req.user;
  res.json({ status: true, data: user.sales });
});

app.post('/api/deletesales', requireUser, async (req, res) => {
  const { salesId } = req.body;
  if (!salesId) {
    return res.json({ status: false, message: 'Missing salesId' });
  }

  const db = await readDb();
  const user = db.users.find((u) => u.id === req.user.id);
  const sale = user.sales.find((item) => item._id === salesId);
  if (!sale) {
    return res.json({ status: false, message: 'Sale not found' });
  }

  sale.cartItems.forEach((item) => {
    const product = user.products.find((p) => p._id === item.c_id);
    if (product) {
      product.p_stock = Number(product.p_stock) + Number(item.c_quantity);
    }
  });

  user.sales = user.sales.filter((item) => item._id !== salesId);
  await writeDb(db);
  res.json({ status: true, message: 'Sale deleted' });
});

await connectMongo();

const server = app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop that process or start this server with another port, for example: $env:PORT=8001; npm start`);
    process.exit(1);
  }
  throw error;
});
