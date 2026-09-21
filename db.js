'use strict';

const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'mozcarbusiness.db');

const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_reference TEXT UNIQUE,
    payment_amount REAL NOT NULL DEFAULT 0,
    payment_transaction TEXT,
    contact_name TEXT NOT NULL,
    contact_phone TEXT NOT NULL,
    contact_email TEXT,
    brand TEXT NOT NULL,
    model TEXT NOT NULL,
    year INTEGER,
    mileage INTEGER,
    fuel TEXT,
    transmission TEXT,
    color TEXT,
    doors INTEGER,
    seats INTEGER,
    city TEXT,
    description TEXT,
    price REAL NOT NULL,
    rejection_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    image TEXT NOT NULL,
    link TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plans (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    fee REAL NOT NULL,
    posts INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    birth_date TEXT,
    id_type TEXT,
    id_number TEXT,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    city TEXT,
    address TEXT,
    location_lat REAL,
    location_lng REAL,
    photo_id_front TEXT,
    photo_id_back TEXT,
    photo_selfie TEXT,
    plan_code TEXT NOT NULL,
    plan_label TEXT NOT NULL,
    plan_fee REAL NOT NULL,
    plan_posts INTEGER NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    payment_reference TEXT UNIQUE,
    payment_transaction TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

/* Migracao: parametros antigos (posts sem vendedor) */
const postCols = db.prepare("SELECT name FROM pragma_table_info('posts')").all().map((c) => c.name);
if (!postCols.includes('seller_id')) db.exec('ALTER TABLE posts ADD COLUMN seller_id INTEGER');

/* Migracao: e-mail e nome de utilizador de acesso do vendedor (unico) */
const sellerCols = db.prepare("SELECT name FROM pragma_table_info('sellers')").all().map((c) => c.name);
if (sellerCols.includes('email')) {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sellers_email ON sellers(email) WHERE email IS NOT NULL AND email <> ''");
}

/* Migracao: e-mail de acesso do administrador */
const adminCols = db.prepare("SELECT name FROM pragma_table_info('admins')").all().map((c) => c.name);
if (!adminCols.includes('email')) db.exec('ALTER TABLE admins ADD COLUMN email TEXT');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_email ON admins(email) WHERE email IS NOT NULL AND email <> ''");

/* Migracao: subscricao trimestral (inicio no dia da aprovacao) e renovacao */
let sellerCols2 = db.prepare("SELECT name FROM pragma_table_info('sellers')").all().map((c) => c.name);
if (!sellerCols2.includes('sub_started_at')) db.exec('ALTER TABLE sellers ADD COLUMN sub_started_at TEXT');
if (!sellerCols2.includes('renewal_pending')) db.exec('ALTER TABLE sellers ADD COLUMN renewal_pending INTEGER NOT NULL DEFAULT 0');
if (!sellerCols2.includes('renewal_reference')) db.exec('ALTER TABLE sellers ADD COLUMN renewal_reference TEXT');
if (!sellerCols2.includes('renewal_transaction')) db.exec('ALTER TABLE sellers ADD COLUMN renewal_transaction TEXT');
if (!sellerCols2.includes('renewal_plan_code')) db.exec('ALTER TABLE sellers ADD COLUMN renewal_plan_code TEXT');
if (!sellerCols2.includes('renewal_plan_label')) db.exec('ALTER TABLE sellers ADD COLUMN renewal_plan_label TEXT');
if (!sellerCols2.includes('renewal_plan_fee')) db.exec('ALTER TABLE sellers ADD COLUMN renewal_plan_fee REAL');
if (!sellerCols2.includes('renewal_plan_posts')) db.exec('ALTER TABLE sellers ADD COLUMN renewal_plan_posts INTEGER');
if (!sellerCols2.includes('upgrade_pending')) db.exec('ALTER TABLE sellers ADD COLUMN upgrade_pending INTEGER NOT NULL DEFAULT 0');
if (!sellerCols2.includes('upgrade_reference')) db.exec('ALTER TABLE sellers ADD COLUMN upgrade_reference TEXT');
if (!sellerCols2.includes('upgrade_transaction')) db.exec('ALTER TABLE sellers ADD COLUMN upgrade_transaction TEXT');
if (!sellerCols2.includes('upgrade_plan_code')) db.exec('ALTER TABLE sellers ADD COLUMN upgrade_plan_code TEXT');
if (!sellerCols2.includes('upgrade_plan_label')) db.exec('ALTER TABLE sellers ADD COLUMN upgrade_plan_label TEXT');
if (!sellerCols2.includes('upgrade_plan_fee')) db.exec('ALTER TABLE sellers ADD COLUMN upgrade_plan_fee REAL');
if (!sellerCols2.includes('upgrade_plan_posts')) db.exec('ALTER TABLE sellers ADD COLUMN upgrade_plan_posts INTEGER');
sellerCols2 = db.prepare("SELECT name FROM pragma_table_info('sellers')").all().map((c) => c.name);
if (sellerCols2.includes('sub_started_at')) {
  db.exec("UPDATE sellers SET sub_started_at = created_at WHERE status = 'approved' AND (sub_started_at IS NULL OR sub_started_at = '')");
}

/* Migracao: pacotes de subscricao geridos pelo administrador (seed inicial) */
const planCount = db.prepare('SELECT COUNT(*) c FROM plans').get().c;
if (planCount === 0) {
  const now = new Date().toISOString();
  const seedPlan = db.prepare('INSERT INTO plans (code, label, fee, posts, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)');
  seedPlan.run('basic', '500 MT', 500, 3, now, now);
  seedPlan.run('pro', '1 000 MT', 1000, 10, now, now);
  seedPlan.run('business', '2 500 MT', 2500, 20, now, now);
  seedPlan.run('vip', '5 500 MT', 5500, 50, now, now);
  console.log('[setup] Pacotes de subscricao criados (basic, pro, business, vip).');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function seedAdmin(username, password, email = '') {
  const row = db.prepare('SELECT id, email FROM admins WHERE username = ?').get(username);
  if (!row) {
    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = hashPassword(password, salt);
    db.prepare('INSERT INTO admins (username, email, password_hash, salt) VALUES (?, ?, ?, ?)')
      .run(username, String(email).trim().toLowerCase(), password_hash, salt);
    console.log(`[setup] Administrador criado: "${username}" (${email || 'sem e-mail'})`);
  } else if (!row.email && email) {
    db.prepare('UPDATE admins SET email = ? WHERE id = ?').run(String(email).trim().toLowerCase(), row.id);
    console.log(`[setup] E-mail do administrador "${username}" atualizado para "${email}"`);
  }
}

module.exports = { db, hashPassword, seedAdmin };