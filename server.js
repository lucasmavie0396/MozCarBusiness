'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, hashPassword } = require('./db');

const PORT = process.env.PORT || 3010;
const APP_NAME = 'MozCarBusiness';
const MAX_PHOTOS = 8;
const MAX_PHOTO_MB = 5;

let PLANS = {};

function refreshPlans() {
  const rows = db.prepare('SELECT * FROM plans ORDER BY fee ASC, code ASC').all();
  const map = {};
  for (const r of rows) map[r.code] = r;
  PLANS = map;
}

refreshPlans();

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const AD_UPLOAD_DIR = path.join(UPLOAD_DIR, 'ads');
const SELLER_UPLOAD_DIR = path.join(UPLOAD_DIR, 'sellers');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(AD_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(SELLER_UPLOAD_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/*  Configuracoes                                                      */
/* ------------------------------------------------------------------ */

const getConfig = () => ({
  appName: APP_NAME,
  contactPhone: '84 000 0000',
  maxPhotos: MAX_PHOTOS,
  plans: Object.entries(PLANS)
    .filter(([, p]) => p.active)
    .map(([code, p]) => ({ code, fee: p.fee, posts: p.posts, label: p.label })),
});

/* ------------------------------------------------------------------ */
/*  Sessoes (admin + vendedores)                                       */
/* ------------------------------------------------------------------ */

const adminSessions = new Map();
const sellerSessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function tokenFromReq(req) {
  const header = req.get('x-admin-token') || req.get('x-seller-token');
  if (header) return header;
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)(?:mcb_admin|mcb_seller)=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function getSession(scheme, req) {
  const token = tokenFromReq(req);
  const s = token && scheme.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { scheme.delete(token); return null; }
  return s;
}

function createSession(map, data) {
  const token = crypto.randomBytes(24).toString('hex');
  map.set(token, { ...data, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function destroySession(map, req) {
  const token = tokenFromReq(req);
  if (token) map.delete(token);
}

function requireAdmin(req, res, next) {
  const s = getSession(adminSessions, req);
  if (!s) return res.status(401).json({ error: 'Sessao do administrador invalida.' });
  req.admin = s;
  next();
}

function requireSeller(req, res, next) {
  const s = getSession(sellerSessions, req);
  if (!s) return res.status(401).json({ error: 'Inicie sessao como vendedor.' });
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(s.sellerId);
  if (!row) return res.status(401).json({ error: 'Conta de vendedor nao encontrada.' });
  req.seller = row;
  next();
}

/* ------------------------------------------------------------------ */
/*  Upload de ficheiros                                                */
/* ------------------------------------------------------------------ */

const stripExt = (name) => name.replace(/\.[^.]+$/, '');

function makeReference(prefix = 'MCB') {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${ymd}-${rand}`;
}

const imageFileFilter = (req, file, cb) => {
  const ext = (path.extname(file.originalname) || '').toLowerCase();
  if (/^image\//.test(file.mimetype) || (file.mimetype === 'application/octet-stream' && ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.avif', '.bmp'].includes(ext))) {
    cb(null, true);
  } else cb(new Error('Apenas imagens sao permitidas (JPG, PNG, WEBP, GIF).'));
};

const carStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = stripExt(file.originalname || 'foto').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'foto';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}.jpg`);
  },
});
const carUpload = multer({
  storage: carStorage,
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024, files: MAX_PHOTOS },
  fileFilter: imageFileFilter,
});

const adStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AD_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = stripExt(file.originalname || 'publicidade').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'publicidade';
    cb(null, `ad-${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}.jpg`);
  },
});
const adUpload = multer({ storage: adStorage, limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024, files: 1 }, fileFilter: imageFileFilter });

const sellerStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, SELLER_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const field = file.fieldname.replace(/[^a-z]/g, '') || 'doc';
    cb(null, `${field}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`);
  },
});
const sellerUpload = multer({
  storage: sellerStorage,
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const num = (v, dflt = null) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; };
const float = (v, dflt = null) => { const n = Number.parseFloat(String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : dflt; };
const text = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '');
const SUBSCRIPTION_MONTHS = 3;

function addMonths(iso, months) {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function subscriptionActive(row) {
  if (!row || row.status !== 'approved' || row.payment_status !== 'paid' || !row.sub_started_at) return false;
  return Date.now() < new Date(addMonths(row.sub_started_at, SUBSCRIPTION_MONTHS)).getTime();
}

function subscriptionJson(row) {
  const start = row.sub_started_at || null;
  const end = start ? addMonths(start, SUBSCRIPTION_MONTHS) : null;
  let subStatus = 'none';
  if (start && row.status === 'approved' && row.payment_status === 'paid') {
    subStatus = Date.now() < new Date(end).getTime() ? 'active' : 'expired';
  } else if (start) {
    subStatus = 'inactive';
  }
  return {
    periodMonths: SUBSCRIPTION_MONTHS,
    quarterStart: start,
    quarterEnd: end,
    subStatus,
    renewalPending: !!row.renewal_pending,
    renewalReference: row.renewal_reference || '',
    renewalTransaction: row.renewal_transaction || '',
    renewalPlan: row.renewal_plan_code
      ? { code: row.renewal_plan_code, label: row.renewal_plan_label, fee: row.renewal_plan_fee, posts: row.renewal_plan_posts }
      : null,
    upgradePending: !!row.upgrade_pending,
    upgradeReference: row.upgrade_reference || '',
    upgradePlan: row.upgrade_plan_code
      ? { code: row.upgrade_plan_code, label: row.upgrade_plan_label, fee: row.upgrade_plan_fee, posts: row.upgrade_plan_posts }
      : null,
  };
}

function photosFor(postId) {
  return db
    .prepare('SELECT filename, position FROM photos WHERE post_id = ? ORDER BY position ASC, id ASC')
    .all(postId)
    .map((p) => `/uploads/${p.filename}`);
}

function sellerJson(row) {
  if (!row) return null;
  const postsUsed = db.prepare("SELECT COUNT(*) c FROM posts WHERE seller_id = ? AND status IN ('pending','approved')").get(row.id).c;
  return {
    id: row.id,
    fullName: row.full_name,
    birthDate: row.birth_date,
    idType: row.id_type,
    idNumber: row.id_number,
    phone: row.phone,
    email: row.email,
    city: row.city,
    address: row.address,
    location: row.location_lat != null && row.location_lng != null ? { lat: row.location_lat, lng: row.location_lng } : null,
    photoIdFront: row.photo_id_front ? `/uploads/sellers/${row.photo_id_front}` : '',
    photoIdBack: row.photo_id_back ? `/uploads/sellers/${row.photo_id_back}` : '',
    photoSelfie: row.photo_selfie ? `/uploads/sellers/${row.photo_selfie}` : '',
    plan: {
      code: row.plan_code,
      label: row.plan_label,
      fee: row.plan_fee,
      posts: row.plan_posts,
      postsUsed,
      postsLeft: Math.max(0, row.plan_posts - postsUsed),
    },
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    paymentTransaction: row.payment_transaction,
    status: row.status,
    rejectionReason: row.rejection_reason,
    subscription: subscriptionJson(row),
    createdAt: row.created_at,
  };
}

function publicCar(row) {
  if (!row) return null;
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    year: row.year,
    mileage: row.mileage,
    fuel: row.fuel,
    transmission: row.transmission,
    color: row.color,
    doors: row.doors,
    seats: row.seats,
    city: row.city,
    description: row.description,
    price: row.price,
    contact: { name: row.contact_name, phone: row.contact_phone, email: row.contact_email },
    photos: photosFor(row.id),
    createdAt: row.created_at,
    publishedAt: row.updated_at,
  };
}

function adminCar(row) {
  if (!row) return null;
  let seller = null;
  if (row.seller_id) {
    const s = db.prepare('SELECT * FROM sellers WHERE id = ?').get(row.seller_id);
    if (s) {
      const postsUsed = db.prepare("SELECT COUNT(*) c FROM posts WHERE seller_id = ? AND status IN ('pending','approved')").get(s.id).c;
      seller = {
        id: s.id,
        fullName: s.full_name,
        phone: s.phone,
        email: s.email,
        city: s.city,
        status: s.status,
        plan: { code: s.plan_code, label: s.plan_label, fee: s.plan_fee, posts: s.plan_posts, postsUsed },
        subscription: subscriptionJson(s),
      };
    }
  }
  return {
    id: row.id,
    sellerId: row.seller_id,
    seller,
    status: row.status,
    brand: row.brand,
    model: row.model,
    year: row.year,
    mileage: row.mileage,
    fuel: row.fuel,
    transmission: row.transmission,
    color: row.color,
    doors: row.doors,
    seats: row.seats,
    city: row.city,
    description: row.description,
    price: row.price,
    rejectionReason: row.rejection_reason,
    photos: photosFor(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function carSellerInfo(row) {
  if (!row || !row.seller_id) return null;
  const s = db.prepare('SELECT id, full_name, city, status, created_at FROM sellers WHERE id = ?').get(row.seller_id);
  if (!s) return null;
  const activePosts = db.prepare("SELECT COUNT(*) c FROM posts WHERE seller_id = ? AND status = 'approved'").get(row.seller_id).c;
  return {
    id: s.id,
    name: s.full_name,
    city: s.city,
    verified: s.status === 'approved',
    memberSince: s.created_at,
    activePosts,
  };
}

function deleteCarFiles(postId) {
  const rows = db.prepare('SELECT filename FROM photos WHERE post_id = ?').all(postId);
  for (const r of rows) fs.promises.unlink(path.join(UPLOAD_DIR, r.filename)).catch(() => {});
  db.prepare('DELETE FROM photos WHERE post_id = ?').run(postId);
}

function deleteSellerFiles(sellerId) {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(sellerId);
  if (!row) return;
  for (const f of [row.photo_id_front, row.photo_id_back, row.photo_selfie]) {
    if (f) fs.promises.unlink(path.join(SELLER_UPLOAD_DIR, f)).catch(() => {});
  }
  const posts = db.prepare('SELECT id FROM posts WHERE seller_id = ?').all(sellerId);
  for (const p of posts) deleteCarFiles(p.id);
  db.prepare('DELETE FROM posts WHERE seller_id = ?').run(sellerId);
}

function adJson(row) {
  return {
    id: row.id,
    title: row.title,
    link: row.link || '',
    active: !!row.active,
    image: `/uploads/ads/${row.image}`,
    position: row.position,
    createdAt: row.created_at,
  };
}

function deleteAdImage(filename) {
  if (!filename) return;
  fs.promises.unlink(path.join(AD_UPLOAD_DIR, filename)).catch(() => {});
}

function planJson(row) {
  const usage = db.prepare('SELECT COUNT(*) c FROM sellers WHERE plan_code = ?').get(row.code).c;
  const pendingRefs = db.prepare('SELECT COUNT(*) c FROM sellers WHERE renewal_plan_code = ? OR upgrade_plan_code = ?').get(row.code, row.code).c;
  return {
    code: row.code,
    label: row.label,
    fee: row.fee,
    posts: row.posts,
    active: !!row.active,
    usage,
    pendingRefs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const timingSafe = (a, b) => {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/api/config', (req, res) => res.json(getConfig()));

app.get('/api/ads', (req, res) => {
  const rows = db.prepare("SELECT * FROM ads WHERE active = 1 ORDER BY position ASC, id ASC").all();
  res.json({ total: rows.length, ads: rows.map(adJson) });
});

/* -------------------------- Loja publica -------------------------- */

app.get('/api/cars', (req, res) => {
  const { search = '', brand = '', fuel = '', transmission = '', sort = 'newest' } = req.query;
  const minP = float(req.query.price_min);
  const maxP = float(req.query.price_max);
  const activeSeller = `(p.seller_id IS NULL OR (s.status = 'approved' AND s.payment_status = 'paid'
    AND julianday(s.sub_started_at, '+${SUBSCRIPTION_MONTHS} months') > julianday('now')))`;
  const conds = ["p.status = 'approved'", activeSeller];
  const params = [];
  if (search) {
    const q = `%${search.trim().toLowerCase()}%`;
    conds.push('(LOWER(p.brand) LIKE ? OR LOWER(p.model) LIKE ? OR LOWER(p.city) LIKE ? OR LOWER(p.description) LIKE ?)');
    params.push(q, q, q, q);
  }
  if (brand) { conds.push('LOWER(p.brand) = ?'); params.push(brand.toLowerCase()); }
  if (fuel) { conds.push('LOWER(p.fuel) = ?'); params.push(fuel.toLowerCase()); }
  if (transmission) { conds.push('LOWER(p.transmission) = ?'); params.push(transmission.toLowerCase()); }
  if (minP != null && minP > 0) { conds.push('p.price >= ?'); params.push(minP); }
  if (maxP != null) { conds.push('p.price <= ?'); params.push(maxP); }
  const order = { newest: 'p.id DESC', oldest: 'p.id ASC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', year_desc: 'p.year DESC' }[sort] || 'p.id DESC';
  const rows = db.prepare(`SELECT p.* FROM posts p LEFT JOIN sellers s ON s.id = p.seller_id WHERE ${conds.join(' AND ')} ORDER BY ${order}`).all(...params);
  res.json({ total: rows.length, cars: rows.map(publicCar) });
});

app.get('/api/cars/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND status = ?').get(req.params.id, 'approved');
  if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado.' });
  if (row.seller_id) {
    const s = db.prepare('SELECT status, payment_status, sub_started_at FROM sellers WHERE id = ?').get(row.seller_id);
    if (!s || !subscriptionActive(s)) return res.status(404).json({ error: 'Anuncio nao encontrado.' });
  }
  const car = publicCar(row);
  car.seller = carSellerInfo(row);
  res.json(car);
});

app.get('/api/brands', (req, res) => {
  const activeSeller = `(p.seller_id IS NULL OR (s.status = 'approved' AND s.payment_status = 'paid'
    AND julianday(s.sub_started_at, '+${SUBSCRIPTION_MONTHS} months') > julianday('now')))`;
  const rows = db.prepare(`SELECT DISTINCT p.brand FROM posts p LEFT JOIN sellers s ON s.id = p.seller_id
    WHERE p.status = 'approved' AND ${activeSeller} AND p.brand <> '' ORDER BY p.brand ASC`).all();
  res.json(rows.map((r) => r.brand));
});

/* ------------------- Registo do vendedor -------------------------- */

app.post('/api/sellers', (req, res) => {
  sellerUpload.fields([
    { name: 'id_front', maxCount: 1 },
    { name: 'id_back', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
  ])(req, res, (err) => {
    const cleanup = () => {
      for (const f of ['id_front', 'id_back', 'selfie']) {
        const arr = req.files && req.files[f];
        if (arr && arr[0]) fs.promises.unlink(path.join(SELLER_UPLOAD_DIR, arr[0].filename)).catch(() => {});
      }
    };
    if (err) return res.status(400).json({ error: err.message || 'Erro ao fazer upload.' });

    const full_name = text(req.body.full_name, 150);
    const phone = normPhone(req.body.phone);
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password == null ? '' : String(req.body.password);
    const plan = PLANS[text(req.body.plan, 20)];

    if (!full_name) return cleanup() || res.status(400).json({ error: 'Preencha o nome completo.' });
    if (phone.length < 9) return cleanup() || res.status(400).json({ error: 'Preencha um telefone valido.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return cleanup() || res.status(400).json({ error: 'Preencha um endereco de e-mail valido.' });
    if (password.length < 6) return cleanup() || res.status(400).json({ error: 'A palavra-passe deve ter pelo menos 6 caracteres.' });
    if (!plan || !plan.active) return cleanup() || res.status(400).json({ error: 'Selecione um plano de subscricao valido e activo.' });
    if (!req.files || !req.files.id_front || !req.files.id_front[0]) return cleanup() || res.status(400).json({ error: 'Adicione a foto da FRENTE do seu documento.' });
    if (!req.files || !req.files.id_back || !req.files.id_back[0]) return cleanup() || res.status(400).json({ error: 'Adicione a foto do VERSO do seu documento.' });
    if (!req.files || !req.files.selfie || !req.files.selfie[0]) return cleanup() || res.status(400).json({ error: 'Adicione uma foto do seu rosto (selfie tirada na hora).' });

    const dupPhone = db.prepare('SELECT id FROM sellers WHERE phone = ?').get(phone);
    if (dupPhone) return cleanup() || res.status(409).json({ error: 'Ja existe uma conta de vendedor registada com este telefone.' });
    const dupEmail = db.prepare('SELECT id FROM sellers WHERE email = ?').get(email);
    if (dupEmail) return cleanup() || res.status(409).json({ error: 'Ja existe uma conta de vendedor registada com este e-mail.' });

    const reference = makeReference('MCB-V');
    const salt = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const done = db.prepare(`
      INSERT INTO sellers (
        full_name, birth_date, id_type, id_number, phone, email, city, address,
        location_lat, location_lng, photo_id_front, photo_id_back, photo_selfie,
        plan_code, plan_label, plan_fee, plan_posts, payment_status, payment_reference,
        password_hash, salt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?, ?)
    `).run(
      full_name, text(req.body.birth_date, 20), text(req.body.id_type, 40), text(req.body.id_number, 60),
      phone, email, text(req.body.city, 80), text(req.body.address, 200),
      float(req.body.location_lat), float(req.body.location_lng),
      req.files.id_front[0].filename, req.files.id_back[0].filename, req.files.selfie[0].filename,
      plan.code, plan.label, plan.fee, plan.posts, reference,
      hashPassword(password, salt), salt, now, now,
    );

    const sellerId = Number(done.lastInsertRowid);
    res.status(201).json({
      message: 'Registo submetido! Conclua o pagamento da subscricao.',
      sellerId,
      paymentReference: reference,
      paymentAmount: plan.fee,
      planPosts: plan.posts,
    });
  });
});

app.post('/api/sellers/renew', requireSeller, (req, res) => {
  const seller = req.seller;
  if (seller.status !== 'approved') {
    return res.status(403).json({ error: 'O seu registo ainda nao foi aprovado pelo administrador.' });
  }
  if (subscriptionActive(seller)) {
    return res.status(400).json({ error: 'A sua subscricao ainda esta ativa. Renove apenas quando o trimestre terminar.' });
  }
  const plan = PLANS[text(req.body.plan, 20)];
  if (!plan || !plan.active) return res.status(400).json({ error: 'Selecione um plano de renovacao valido e activo.' });
  const reference = makeReference('MCB-R');
  db.prepare(`
    UPDATE sellers SET renewal_pending = 1, renewal_reference = ?, renewal_transaction = NULL,
      renewal_plan_code = ?, renewal_plan_label = ?, renewal_plan_fee = ?, renewal_plan_posts = ?, updated_at = ?
    WHERE id = ?`).run(reference, plan.code, plan.label, plan.fee, plan.posts, new Date().toISOString(), seller.id);
  res.status(201).json({ message: 'Referencia de renovacao criada.', reference, amount: plan.fee, planLabel: plan.label });
});

app.post('/api/sellers/renew/pay', requireSeller, (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.seller.id);
  if (!row.renewal_pending) return res.status(400).json({ error: 'Nao existe nenhuma renovacao em curso.' });
  const reference = text(req.body.reference, 40).toUpperCase();
  if (reference !== row.renewal_reference) return res.status(400).json({ error: 'Referencia de renovacao invalida.' });
  const transaction = text(req.body.transaction, 60);
  if (!transaction) return res.status(400).json({ error: 'Indique o numero/ID da transaccao M-Pesa ou E-Mola.' });
  db.prepare("UPDATE sellers SET renewal_transaction = ?, updated_at = ? WHERE id = ?")
    .run(transaction, new Date().toISOString(), row.id);
  res.json({ message: 'Pagamento da renovacao recebido! A aguardar a confirmacao do administrador.', renewalPending: true });
});

app.post('/api/sellers/upgrade', requireSeller, (req, res) => {
  const seller = req.seller;
  if (seller.status !== 'approved') {
    return res.status(403).json({ error: 'O seu registo ainda nao foi aprovado pelo administrador.' });
  }
  if (!subscriptionActive(seller)) {
    return res.status(403).json({ error: 'A sua subscricao trimestral expirou. Renove antes de fazer um upgrade.' });
  }
  const plan = PLANS[text(req.body.plan, 20)];
  if (!plan || !plan.active) return res.status(400).json({ error: 'Selecione um pacote de upgrade valido e activo.' });
  if (plan.fee <= seller.plan_fee) {
    return res.status(400).json({ error: 'Escolha um pacote superior ao atual (' + seller.plan_label + ').' });
  }
  const used = db.prepare("SELECT COUNT(*) c FROM posts WHERE seller_id = ? AND status IN ('pending','approved')").get(seller.id).c;
  if (used >= plan.posts) {
    return res.status(400).json({ error: `O pacote ${plan.label} nao acrescenta publicacoes suficientes. Escolha um pacote com mais de ${used} publicacoes.` });
  }
  const diff = plan.fee - seller.plan_fee;
  const reference = makeReference('MCB-U');
  db.prepare(`
    UPDATE sellers SET upgrade_pending = 1, upgrade_reference = ?, upgrade_transaction = NULL,
      upgrade_plan_code = ?, upgrade_plan_label = ?, upgrade_plan_fee = ?, upgrade_plan_posts = ?, updated_at = ?
    WHERE id = ?`).run(reference, plan.code, plan.label, plan.fee, plan.posts, new Date().toISOString(), seller.id);
  res.status(201).json({ message: 'Referencia de upgrade criada.', reference, amount: diff, currentFee: seller.plan_fee, planLabel: plan.label, planPosts: plan.posts });
});

app.post('/api/sellers/upgrade/pay', requireSeller, (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.seller.id);
  if (!row.upgrade_pending) return res.status(400).json({ error: 'Nao existe nenhum upgrade em curso.' });
  const reference = text(req.body.reference, 40).toUpperCase();
  if (reference !== row.upgrade_reference) return res.status(400).json({ error: 'Referencia de upgrade invalida.' });
  const transaction = text(req.body.transaction, 60);
  if (!transaction) return res.status(400).json({ error: 'Indique o numero/ID da transaccao M-Pesa ou E-Mola.' });
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sellers SET plan_code = ?, plan_label = ?, plan_fee = ?, plan_posts = ?,
      upgrade_pending = 0, upgrade_reference = NULL, upgrade_transaction = NULL,
      upgrade_plan_code = NULL, upgrade_plan_label = NULL, upgrade_plan_fee = NULL, upgrade_plan_posts = NULL,
      updated_at = ?
    WHERE id = ?`).run(row.upgrade_plan_code, row.upgrade_plan_label, row.upgrade_plan_fee, row.upgrade_plan_posts, now, row.id);
  const fresh = db.prepare('SELECT * FROM sellers WHERE id = ?').get(row.id);
  const sj = sellerJson(fresh);
  res.json({ message: 'Pacote atualizado com sucesso! A sua subscricao trimestral continua ativa com mais publicacoes.', plan: sj.plan });
});

app.post('/api/sellers/:id/pay', (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Registo nao encontrado.' });
  const transaction = text(req.body.transaction, 60);
  if (!transaction) return res.status(400).json({ error: 'Indique o numero/ID da transaccao M-Pesa ou E-Mola.' });
  if (row.payment_status === 'paid') {
    return res.json({ message: 'Pagamento ja confirmado. Aguarde a aprovacao do administrador.', paymentStatus: 'paid' });
  }
  db.prepare("UPDATE sellers SET payment_status = 'paid', payment_transaction = ?, updated_at = ? WHERE id = ?")
    .run(transaction, new Date().toISOString(), row.id);
  res.json({ message: 'Pagamento recebido! O registo esta em revisao pelo administrador.', paymentStatus: 'paid' });
});

app.get('/api/track', (req, res) => {
  const ref = text(req.query.reference, 40).toUpperCase();
  if (!ref) return res.status(400).json({ error: 'Indique a referencia de pagamento.' });
  const row = db.prepare('SELECT * FROM sellers WHERE payment_reference = ?').get(ref);
  if (!row) return res.status(404).json({ error: 'Referencia nao encontrada.' });
  res.json({
    type: 'seller',
    id: row.id,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    paymentAmount: row.plan_fee,
    planLabel: row.plan_label,
    paymentTransaction: row.payment_transaction,
    rejectionReason: row.rejection_reason,
    name: row.full_name,
  });
});

/* ----------------- Sessao do vendedor (login) --------------------- */

app.post('/api/sellers/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password == null ? '' : String(req.body.password);
  const row = db.prepare('SELECT * FROM sellers WHERE email = ?').get(email);
  if (!row || !timingSafe(hashPassword(password, row.salt), row.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou palavra-passe incorretos.' });
  }
  const token = createSession(sellerSessions, { sellerId: row.id });
  res.setHeader('Set-Cookie', `mcb_seller=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  res.json({ token, seller: sellerJson(row) });
});

app.get('/api/sellers/me', requireSeller, (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.seller.id);
  res.json(sellerJson(row));
});

app.post('/api/sellers/logout', (req, res) => {
  destroySession(sellerSessions, req);
  res.status(204).end();
});

app.get('/api/sellers/me/posts', requireSeller, (req, res) => {
  const rows = db.prepare('SELECT * FROM posts WHERE seller_id = ? ORDER BY id DESC').all(req.seller.id);
  const hidden = !subscriptionActive(req.seller);
  const posts = rows.map((r) => ({ ...adminCar(r), hidden }));
  res.json({ seller: sellerJson(req.seller), posts });
});

app.put('/api/sellers/me/password', requireSeller, (req, res) => {
  const seller = req.seller;
  const currentPassword = req.body.currentPassword == null ? '' : String(req.body.currentPassword);
  const password = req.body.password == null ? '' : String(req.body.password);
  if (!timingSafe(hashPassword(currentPassword, seller.salt), seller.password_hash)) {
    return res.status(401).json({ error: 'Palavra-passe atual incorreta.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'A nova palavra-passe deve ter pelo menos 6 caracteres.' });
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE sellers SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?')
    .run(hashPassword(password, salt), salt, new Date().toISOString(), seller.id);
  res.json({ message: 'Palavra-passe atualizada com sucesso.' });
});

app.get('/api/sellers/:id/profile', (req, res) => {
  const s = db.prepare("SELECT * FROM sellers WHERE id = ? AND status = 'approved'").get(req.params.id);
  if (!s || !subscriptionActive(s)) return res.status(404).json({ error: 'Vendedor nao encontrado.' });
  const posts = db.prepare("SELECT * FROM posts WHERE seller_id = ? AND status = 'approved' ORDER BY id DESC").all(s.id);
  res.json({
    seller: {
      id: s.id,
      name: s.full_name,
      city: s.city,
      phone: s.phone,
      email: s.email || '',
      verified: true,
      memberSince: s.created_at,
      activePosts: posts.length,
    },
    cars: posts.map(publicCar),
  });
});

/* ------------------- Publicacao de carros ------------------------- */

app.post('/api/cars', requireSeller, (req, res) => {
  const seller = req.seller;

  if (seller.status !== 'approved') {
    return res.status(403).json({ error: seller.status === 'rejected' ? 'O seu registo foi recusado. Contacte a administracao.' : 'A sua conta ainda esta em aprovacao.' });
  }
  if (!subscriptionActive(seller)) {
    return res.status(403).json({ error: 'A sua subscricao trimestral expirou. Renove o seu pacote para voltar a publicar.' });
  }
  const used = db.prepare("SELECT COUNT(*) c FROM posts WHERE seller_id = ? AND status IN ('pending','approved')").get(seller.id).c;
  if (used >= seller.plan_posts) {
    return res.status(403).json({ error: `Plano esgotado: ${seller.plan_label} permite ${seller.plan_posts} publicacoes por trimestre.`, needUpgrade: true });
  }

  carUpload.array('photos', MAX_PHOTOS)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Erro ao fazer upload das fotos.' });

    const cleanUploads = () => { if (req.files) for (const f of req.files) fs.promises.unlink(path.join(UPLOAD_DIR, f.filename)).catch(() => {}); };

    const brand = text(req.body.brand, 80);
    const model = text(req.body.model, 80);
    const price = float(req.body.price);
    if (!brand) return cleanUploads() || res.status(400).json({ error: 'Preencha a marca do carro.' });
    if (!model) return cleanUploads() || res.status(400).json({ error: 'Preencha o modelo do carro.' });
    if (price == null || price <= 0) return cleanUploads() || res.status(400).json({ error: 'Preencha um preco valido.' });
    if (!req.files || req.files.length === 0) return cleanUploads() || res.status(400).json({ error: 'Adicione pelo menos uma foto do carro.' });

    const now = new Date().toISOString();
    const done = db.prepare(`
      INSERT INTO posts (
        seller_id, status, payment_status, contact_name, contact_phone, contact_email,
        brand, model, year, mileage, fuel, transmission, color, doors, seats,
        city, description, price, created_at, updated_at
      ) VALUES (?, 'pending', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      seller.id,
      seller.full_name, seller.phone, seller.email,
      brand, model, num(req.body.year), num(req.body.mileage), text(req.body.fuel, 30), text(req.body.transmission, 30),
      text(req.body.color, 40), num(req.body.doors), num(req.body.seats), text(req.body.city, 80),
      text(req.body.description, 4000), price, now, now,
    );

    const postId = Number(done.lastInsertRowid);
    const stmt = db.prepare('INSERT INTO photos (post_id, filename, position) VALUES (?, ?, ?)');
    req.files.forEach((f, i) => stmt.run(postId, f.filename, i));

    res.status(201).json({
      id: postId,
      status: 'pending',
      seller: sellerJson(seller),
      postsUsed: used + 1,
      planPosts: seller.plan_posts,
    });
  });
});

/* --------------------------- API do admin ------------------------- */

app.get('/api/admin/status', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  res.json({ adminExists: n > 0 });
});

app.post('/api/admin/setup', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (n > 0) return res.status(403).json({ error: 'Ja existe uma conta de administrador.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password == null ? '' : String(req.body.password);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Introduza um e-mail valido.' });
  if (password.length < 6) return res.status(400).json({ error: 'A palavra-passe deve ter pelo menos 6 caracteres.' });
  const username = (email.split('@')[0] || 'admin').replace(/[^a-z0-9_.-]/g, '') || 'admin';
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO admins (username, email, password_hash, salt) VALUES (?, ?, ?, ?)')
    .run(username, email, hashPassword(password, salt), salt);
  const row = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  const token = createSession(adminSessions, { adminId: row.id, username: row.username });
  res.setHeader('Set-Cookie', `mcb_admin=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  res.status(201).json({ token, username: row.username, email: row.email });
});

app.post('/api/admin/login', (req, res) => {
  if (db.prepare('SELECT COUNT(*) c FROM admins').get().c === 0) {
    return res.status(409).json({ error: 'Nenhum administrador configurado. Faca o primeiro acesso.', needsSetup: true });
  }
  const ident = String(req.body.username || req.body.email || '').trim();
  const password = req.body.password == null ? '' : String(req.body.password);
  const row = db.prepare('SELECT * FROM admins WHERE username = ? OR email = ?').get(ident, ident.trim().toLowerCase());
  if (!row || !timingSafe(hashPassword(password, row.salt), row.password_hash)) {
    return res.status(401).json({ error: 'Credenciais invalidas.' });
  }
  const token = createSession(adminSessions, { adminId: row.id, username: row.username });
  res.setHeader('Set-Cookie', `mcb_admin=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
  res.json({ token, username: row.username, email: row.email || '' });
});

app.get('/api/admin/session', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT username, email FROM admins WHERE id = ?').get(req.admin.adminId);
  res.json({ username: row.username, email: row.email || '' });
});

app.put('/api/admin/profile', requireAdmin, (req, res) => {
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.adminId);
  const email = String(req.body.email || '').trim().toLowerCase();
  const currentPassword = req.body.currentPassword == null ? '' : String(req.body.currentPassword);
  const newPassword = req.body.newPassword == null ? '' : String(req.body.newPassword);
  const changes = [];

  if (email && email !== (admin.email || '')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'E-mail de acesso invalido.' });
    const clash = db.prepare('SELECT id FROM admins WHERE email = ? AND id <> ?').get(email, admin.id);
    if (clash) return res.status(400).json({ error: 'Ja existe outro utilizador registado com este e-mail.' });
    db.prepare('UPDATE admins SET email = ? WHERE id = ?').run(email, admin.id);
    changes.push('e-mail de acesso');
  }

  if (newPassword) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'A nova palavra-passe deve ter pelo menos 6 caracteres.' });
    if (!timingSafe(hashPassword(currentPassword, admin.salt), admin.password_hash)) {
      return res.status(400).json({ error: 'Palavra-passe atual incorreta.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE admins SET password_hash = ?, salt = ? WHERE id = ?').run(hashPassword(newPassword, salt), salt, admin.id);
    changes.push('palavra-passe');
  }

  res.json({
    message: changes.length ? 'Dados atualizados: ' + changes.join(' e ') + '.' : 'Sem alteracoes para guardar.',
    username: admin.username,
    email,
  });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => { destroySession(adminSessions, req); res.status(204).end(); });

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const q = (sql) => db.prepare(sql).get().c;
  const stats = {
    postsPending: q("SELECT COUNT(*) c FROM posts WHERE status = 'pending'"),
    postsApproved: q("SELECT COUNT(*) c FROM posts WHERE status = 'approved'"),
    postsRejected: q("SELECT COUNT(*) c FROM posts WHERE status = 'rejected'"),
    sellersPending: q("SELECT COUNT(*) c FROM sellers WHERE status = 'pending'"),
    sellersApproved: q("SELECT COUNT(*) c FROM sellers WHERE status = 'approved'"),
    sellersRejected: q("SELECT COUNT(*) c FROM sellers WHERE status = 'rejected'"),
    sellersAwaitingPayment: q("SELECT COUNT(*) c FROM sellers WHERE status = 'pending' AND payment_status = 'unpaid'"),
    sellersPaidAwaitingReview: q("SELECT COUNT(*) c FROM sellers WHERE status = 'pending' AND payment_status = 'paid'"),
    sellersExpired: q("SELECT COUNT(*) c FROM sellers WHERE status = 'approved' AND payment_status = 'paid' AND sub_started_at IS NOT NULL AND julianday(sub_started_at, '+3 months') <= julianday('now')"),
    sellersRenewalPending: q("SELECT COUNT(*) c FROM sellers WHERE renewal_pending = 1"),
    revenue: db.prepare("SELECT COALESCE(SUM(plan_fee), 0) s FROM sellers WHERE payment_status = 'paid'").get().s,
  };
  res.json(stats);
});

/* --- Anuncios de carros --- */

app.get('/api/admin/posts', requireAdmin, (req, res) => {
  const status = req.query.status || 'all';
  const sel = req.query.seller || 'all';
  const conds = [];
  const params = [];
  if (status !== 'all') conds.push("p.status = ?"), params.push(String(status).replace(/[^a-z]/gi, ''));
  if (sel === 'pending') conds.push("p.status = 'pending'");
  if (sel === 'approved') conds.push("p.status = 'approved'");
  if (sel === 'rejected') conds.push("p.status = 'rejected'");
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT p.* FROM posts p ${where} ORDER BY p.id DESC`).all(...params);
  res.json({ posts: rows.map(adminCar) });
});

app.get('/api/admin/posts/:id', requireAdmin, (req, res) => {
  const post = adminCar(db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id));
  if (!post) return res.status(404).json({ error: 'Anuncio nao encontrado.' });
  res.json(post);
});

app.post('/api/admin/posts/:id/approve', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado.' });
  db.prepare("UPDATE posts SET status = 'approved', updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  res.json({ message: 'Anuncio aprovado e publicado.' });
});

app.post('/api/admin/posts/:id/reject', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado.' });
  const reason = text(req.body.reason, 500) || 'O anuncio foi recusado pela administracao.';
  db.prepare("UPDATE posts SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?")
    .run(reason, new Date().toISOString(), row.id);
  res.json({ message: 'Anuncio recusado.' });
});

app.delete('/api/admin/posts/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Anuncio nao encontrado.' });
  deleteCarFiles(row.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(row.id);
  res.status(204).end();
});

/* --- Vendedores --- */

app.get('/api/admin/sellers', requireAdmin, (req, res) => {
  const status = req.query.status || 'all';
  const cond = status === 'all' ? '' : `WHERE status = '${String(status).replace(/[^a-z]/gi, '')}'`;
  const rows = db.prepare(`SELECT * FROM sellers ${cond} ORDER BY id DESC`).all();
  res.json({ sellers: rows.map(sellerJson) });
});

app.get('/api/admin/sellers/:id', requireAdmin, (req, res) => {
  const seller = sellerJson(db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.params.id));
  if (!seller) return res.status(404).json({ error: 'Vendedor nao encontrado.' });
  const posts = db.prepare('SELECT * FROM posts WHERE seller_id = ? ORDER BY id DESC').all(req.params.id);
  res.json({ seller, posts: posts.map(adminCar) });
});

app.post('/api/admin/sellers/:id/approve', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vendedor nao encontrado.' });
  if (row.payment_status !== 'paid') {
    return res.status(400).json({ error: 'Nao pode aprovar um vendedor cujo pagamento da subscricao ainda nao foi confirmado.' });
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE sellers SET status = 'approved', sub_started_at = ?, updated_at = ? WHERE id = ?")
    .run(row.sub_started_at || now, now, row.id);
  res.json({ message: 'Vendedor aprovado. O trimestre de subscricao comeca hoje e as publicacoes ficam visiveis na loja.' });
});

app.post('/api/admin/sellers/:id/renewal-confirm', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vendedor nao encontrado.' });
  if (!row.renewal_pending) return res.status(400).json({ error: 'Este vendedor nao tem renovacao em curso.' });
  if (!row.renewal_transaction) {
    return res.status(400).json({ error: 'A renovacao ainda nao foi paga pelo vendedor.' });
  }
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE sellers SET
      plan_code = ?, plan_label = ?, plan_fee = ?, plan_posts = ?,
      payment_status = 'paid', sub_started_at = ?,
      renewal_pending = 0, renewal_reference = NULL, renewal_transaction = NULL,
      renewal_plan_code = NULL, renewal_plan_label = NULL, renewal_plan_fee = NULL, renewal_plan_posts = NULL,
      updated_at = ? WHERE id = ?`)
    .run(row.renewal_plan_code, row.renewal_plan_label, row.renewal_plan_fee, row.renewal_plan_posts,
      now, now, row.id);
  res.json({ message: 'Renovacao confirmada. Novo trimestre iniciado — as publicacoes voltaram a ficar visiveis na loja.' });
});

app.post('/api/admin/sellers/:id/renewal-reject', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vendedor nao encontrado.' });
  db.prepare(`
    UPDATE sellers SET renewal_pending = 0, renewal_reference = NULL, renewal_transaction = NULL,
      renewal_plan_code = NULL, renewal_plan_label = NULL, renewal_plan_fee = NULL, renewal_plan_posts = NULL,
      updated_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
  res.json({ message: 'Renovacao cancelada. O vendedor pode reiniciar a renovacao quando quiser.' });
});

app.post('/api/admin/sellers/:id/reject', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vendedor nao encontrado.' });
  const reason = text(req.body.reason, 500) || 'O registo foi recusado pela administracao.';
  db.prepare("UPDATE sellers SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?")
    .run(reason, new Date().toISOString(), row.id);
  res.json({ message: 'Registo recusado.' });
});

app.delete('/api/admin/sellers/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vendedor nao encontrado.' });
  deleteSellerFiles(row.id);
  db.prepare('DELETE FROM sellers WHERE id = ?').run(row.id);
  res.status(204).end();
});

/* --- Publicidade --- */

app.get('/api/admin/ads', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM ads ORDER BY position ASC, id ASC').all();
  res.json({ ads: rows.map(adJson) });
});

app.post('/api/admin/ads', requireAdmin, (req, res) => {
  adUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Erro ao fazer upload da imagem.' });
    const title = text(req.body.title, 120);
    if (!title) {
      if (req.file) fs.promises.unlink(path.join(AD_UPLOAD_DIR, req.file.filename)).catch(() => {});
      return res.status(400).json({ error: 'Adicione um titulo para a publicidade.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Adicione uma imagem de publicidade (idealmente 1600x600).' });
    const maxPos = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM ads').get().m;
    const done = db.prepare('INSERT INTO ads (title, image, link, active, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(title, req.file.filename, text(req.body.link, 300), req.body.active === '1' || req.body.active === 'true' ? 1 : 0, maxPos + 1, new Date().toISOString());
    res.status(201).json({ message: 'Publicidade criada.', ad: adJson(db.prepare('SELECT * FROM ads WHERE id = ?').get(Number(done.lastInsertRowid))) });
  });
});

app.post('/api/admin/ads/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM ads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Publicidade nao encontrada.' });
  adUpload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Erro ao fazer upload da imagem.' });
    const title = req.body.title === undefined || req.body.title === '' ? row.title : text(req.body.title, 120);
    const link = req.body.link === undefined ? row.link : text(req.body.link, 300);
    const active = req.body.active === undefined ? row.active : (req.body.active === '1' || req.body.active === 'true' ? 1 : 0);
    if (req.file && row.image) deleteAdImage(row.image);
    db.prepare('UPDATE ads SET title = ?, link = ?, active = ?, image = ? WHERE id = ?')
      .run(title, link, active, req.file ? req.file.filename : row.image, row.id);
    res.json({ message: 'Publicidade atualizada.', ad: adJson(db.prepare('SELECT * FROM ads WHERE id = ?').get(row.id)) });
  });
});

app.post('/api/admin/ads/:id/toggle', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM ads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Publicidade nao encontrada.' });
  const next = row.active ? 0 : 1;
  db.prepare('UPDATE ads SET active = ? WHERE id = ?').run(next, row.id);
  res.json({ message: next ? 'Publicidade ativada.' : 'Publicidade desativada.', active: !!next });
});

app.post('/api/admin/ads/:id/move', requireAdmin, (req, res) => {
  const dir = req.body.dir === 'up' ? 'up' : 'down';
  const row = db.prepare('SELECT * FROM ads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Publicidade nao encontrada.' });
  const other = dir === 'up'
    ? db.prepare('SELECT * FROM ads WHERE position < ? ORDER BY position DESC LIMIT 1').get(row.position)
    : db.prepare('SELECT * FROM ads WHERE position > ? ORDER BY position ASC LIMIT 1').get(row.position);
  if (!other) return res.json({ message: dir === 'up' ? 'Ja e a primeira.' : 'Ja e a ultima.' });
  db.prepare('UPDATE ads SET position = ? WHERE id = ?').run(other.position, row.id);
  db.prepare('UPDATE ads SET position = ? WHERE id = ?').run(row.position, other.id);
  res.json({ message: 'Ordem atualizada.' });
});

app.delete('/api/admin/ads/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM ads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Publicidade nao encontrada.' });
  deleteAdImage(row.image);
  db.prepare('DELETE FROM ads WHERE id = ?').run(row.id);
  res.status(204).end();
});

/* --- Pacotes (planos de subscricao) --- */

app.get('/api/admin/plans', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM plans ORDER BY fee ASC, code ASC').all();
  res.json({ plans: rows.map(planJson) });
});

app.post('/api/admin/plans', requireAdmin, (req, res) => {
  const code = text(req.body.code, 20).toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const label = text(req.body.label, 60);
  const fee = float(req.body.fee);
  const posts = num(req.body.posts);
  if (!code) return res.status(400).json({ error: 'Indique um codigo para o pacote (ex.: gold).' });
  if (db.prepare('SELECT code FROM plans WHERE code = ?').get(code)) {
    return res.status(409).json({ error: 'Ja existe um pacote com este codigo.' });
  }
  if (!label) return res.status(400).json({ error: 'Indique uma etiqueta para o pacote (ex.: "3 000 MT").' });
  if (fee == null || fee <= 0) return res.status(400).json({ error: 'Indique o valor da taxa em MT.' });
  if (posts == null || posts < 1) return res.status(400).json({ error: 'Indique o numero de publicacoes permitidas.' });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO plans (code, label, fee, posts, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .run(code, label, fee, posts, now, now);
  refreshPlans();
  res.status(201).json({ message: 'Pacote criado e activo.', plan: planJson(db.prepare('SELECT * FROM plans WHERE code = ?').get(code)) });
});

app.put('/api/admin/plans/:code', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM plans WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'Pacote nao encontrado.' });
  const label = req.body.label === undefined ? row.label : text(req.body.label, 60);
  const fee = req.body.fee === undefined ? row.fee : float(req.body.fee);
  const posts = req.body.posts === undefined ? row.posts : num(req.body.posts);
  const active = req.body.active === undefined ? row.active : (req.body.active ? 1 : 0);
  if (!label) return res.status(400).json({ error: 'A etiqueta nao pode ficar vazia.' });
  if (fee == null || fee <= 0) return res.status(400).json({ error: 'Indique o valor da taxa em MT.' });
  if (posts == null || posts < 1) return res.status(400).json({ error: 'Indique o numero de publicacoes permitidas.' });
  db.prepare('UPDATE plans SET label = ?, fee = ?, posts = ?, active = ?, updated_at = ? WHERE code = ?')
    .run(label, fee, posts, active, new Date().toISOString(), row.code);
  refreshPlans();
  res.json({ message: 'Pacote atualizado. As alteracoes aplicam-se a novas subscricoes, renovacoes e upgrades.' });
});

app.post('/api/admin/plans/:code/toggle', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM plans WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'Pacote nao encontrado.' });
  const next = row.active ? 0 : 1;
  db.prepare('UPDATE plans SET active = ?, updated_at = ? WHERE code = ?').run(next, new Date().toISOString(), row.code);
  refreshPlans();
  res.json({ message: next ? 'Pacote ativado e visivel para os vendedores.' : 'Pacote desativado (deixa de aparecer no registo, renovacao e upgrade).', active: !!next });
});

app.delete('/api/admin/plans/:code', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM plans WHERE code = ?').get(req.params.code);
  if (!row) return res.status(404).json({ error: 'Pacote nao encontrado.' });
  const usage = db.prepare('SELECT COUNT(*) c FROM sellers WHERE plan_code = ?').get(row.code).c;
  if (usage > 0) {
    return res.status(409).json({ error: `Nao pode apagar: ${usage} vendedor(es) estao subscritos neste pacote. Desative-o em vez de apagar.` });
  }
  const pendingRefs = db.prepare('SELECT COUNT(*) c FROM sellers WHERE renewal_plan_code = ? OR upgrade_plan_code = ?').get(row.code, row.code).c;
  if (pendingRefs > 0) {
    return res.status(409).json({ error: 'Nao pode apagar: o pacote esta referenciado numa renovacao/upgrade em curso. Desative-o em vez de apagar.' });
  }
  db.prepare('DELETE FROM plans WHERE code = ?').run(row.code);
  refreshPlans();
  res.status(204).end();
});

/* ---------------------------- Frontend ---------------------------- */

app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/registar', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'registar.html')));
app.get('/entrar', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'entrar.html')));
app.get('/minha-conta', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'conta.html')));
app.get('/sell', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'sell.html')));
app.get('/payment', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'payment.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.use('/static', express.static(PUBLIC_DIR, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

app.use((req, res) => res.status(404).json({ error: 'Rota nao encontrada.' }));

/* ------------------------------------------------------------------ */

const server = http.createServer(app);
server.listen(PORT, () => {
  console.log('==============================================');
  console.log(`  ${APP_NAME} a correr em http://localhost:${PORT}`);
  console.log(`  Loja:            http://localhost:${PORT}/`);
  console.log(`  Registar vendedor http://localhost:${PORT}/registar`);
  console.log(`  Entrar vendedor   http://localhost:${PORT}/entrar`);
  console.log(`  Minha conta       http://localhost:${PORT}/minha-conta`);
  const nAdmins = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (nAdmins === 0) {
    console.log('  Painel admin:    http://localhost:${PORT}/admin  (primeiro acesso: criar credenciais)');
  } else {
    console.log('  Painel admin:    http://localhost:${PORT}/admin');
  }
  console.log('==============================================');
});