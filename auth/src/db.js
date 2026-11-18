const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'auth.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function createSchema() {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- One row per login. Every token issued since v2 carries its row's id as
    -- the "sid" claim, which is what makes a single login revocable (sign out
    -- a lost phone, "sign out everywhere") without changing how any app's own
    -- backend verifies tokens — they still only check the JWT signature.
    --
    -- parent_id links a session that Quarc Store minted for another app on the
    -- same device to the Store's own session, so revoking the Store's login
    -- revokes every app it signed in, in one go.
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      parent_id TEXT,
      client TEXT NOT NULL DEFAULT 'web',
      device TEXT,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);

    -- "Sign in with your phone": a computer asks, the user's Quarc Store
    -- approves by typing the number the computer shows. The computer polls
    -- with a secret only it knows (stored hashed); the phone sees only id.
    CREATE TABLE IF NOT EXISTS login_requests (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL,
      user_id TEXT,              -- null when the username doesn't exist: never approvable
      number INTEGER NOT NULL,
      client TEXT,
      device TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'   -- pending | approved | denied | used
    );
    CREATE INDEX IF NOT EXISTS idx_login_requests_user ON login_requests(user_id, status);
  `);

  // v1 databases (created by the original quarc-auth)
  // don't have this column yet. Tokens issued before this timestamp are
  // rejected — the only way to cut off pre-v2 tokens, which have no sid.
  const cols = database.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('tokens_valid_after')) {
    database.exec('ALTER TABLE users ADD COLUMN tokens_valid_after INTEGER NOT NULL DEFAULT 0');
  }
  return database;
}

function initDb() {
  const database = createSchema();
  ensureAdmin(database);
}

function ensureAdmin(database) {
  const existing = database.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
  if (existing.c > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  let password = process.env.ADMIN_PASSWORD;

  // A migrated database may already hold a regular user with this name.
  const clash = database.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (clash) {
    database.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(clash.id);
    console.log(`Promoted existing user "${username}" to admin (no admin existed).`);
    return;
  }

  if (!password) {
    password = crypto.randomBytes(12).toString('hex');
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║    Admin account created automatically    ║');
    console.log(`║    Username : ${username.padEnd(26)}║`);
    console.log(`║    Password : ${password.padEnd(26)}║`);
    console.log('║    Save this — it will not show again     ║');
    console.log('╚══════════════════════════════════════════╝\n');
  }

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = bcrypt.hashSync(password, 12);

  database.prepare(
    'INSERT INTO users (id, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)'
  ).run(uuidv4(), username, hash, salt, 'admin');
}

module.exports = { getDb, initDb, createSchema, ensureAdmin };
