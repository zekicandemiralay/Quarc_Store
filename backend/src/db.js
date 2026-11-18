const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'store.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

function initDb() {
  getDb().exec(`
    -- The catalog: which apps Quarc Store lists. Admin-editable.
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tagline TEXT,
      description TEXT,
      repo TEXT,               -- GitHub "owner/name"; releases come from here
      package_name TEXT,       -- Android applicationId; null for non-Android apps
      web_url TEXT,            -- where the web version lives, if any
      icon_url TEXT,
      accent TEXT,             -- tile colour when there's no icon
      sso INTEGER NOT NULL DEFAULT 1,   -- may receive a login from Quarc Store
      cert_sha256 TEXT,        -- extra allowed signing-cert fingerprints (comma separated), e.g. debug builds
      hidden INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Mirror of each app's GitHub releases (newest first by published_at).
    CREATE TABLE IF NOT EXISTS releases (
      app_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      version TEXT NOT NULL,
      name TEXT,
      body TEXT,
      published_at TEXT,
      html_url TEXT,
      assets_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (app_id, tag)
    );

    -- Signing-cert fingerprint of an APK, computed once per release asset.
    CREATE TABLE IF NOT EXISTS apk_certs (
      asset_url TEXT PRIMARY KEY,
      sha256 TEXT,
      error TEXT,
      computed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      app_id TEXT PRIMARY KEY,
      etag TEXT,
      last_checked_at TEXT,
      last_success_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Added after the first version of the schema.
  const cols = getDb().prepare('PRAGMA table_info(apps)').all().map((c) => c.name);
  if (!cols.includes('min_version')) {
    // Oldest version still allowed to run. Older installs are told to update
    // (the Store marks it Required; the app shows a blocking update screen).
    getDb().exec('ALTER TABLE apps ADD COLUMN min_version TEXT');
  }
}

function getMeta(key) {
  return getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
function setMeta(key, value) {
  getDb().prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

module.exports = { getDb, initDb, getMeta, setMeta };
