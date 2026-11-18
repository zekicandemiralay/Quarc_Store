// Builds the catalog JSON that the Store app, the Store web page and the
// Store's native background worker all read.

const { getDb } = require('../db');
const { normalizeFingerprint } = require('./apkCert');

// Asset platform → the family shown as a badge on the app's card.
const PLATFORM_FAMILY = {
  android: 'android',
  windows: 'windows',
  'macos-arm': 'macos',
  'macos-intel': 'macos',
  'linux-deb': 'linux',
  'linux-appimage': 'linux',
  'linux-rpm': 'linux',
};
const FAMILY_ORDER = ['android', 'windows', 'macos', 'linux', 'web'];

function shapeRelease(row, { withAssets = true } = {}) {
  const assets = JSON.parse(row.assets_json || '[]');
  const out = {
    tag: row.tag,
    version: row.version,
    name: row.name,
    notes: row.body,
    publishedAt: row.published_at,
    htmlUrl: row.html_url,
  };
  if (withAssets) {
    const byPlatform = {};
    const other = [];
    for (const a of assets) {
      const item = { name: a.name, url: a.url, size: a.size };
      if (a.platform === 'other') other.push(item);
      else if (!byPlatform[a.platform]) byPlatform[a.platform] = item;
    }
    out.assets = byPlatform;
    out.otherAssets = other;
  }
  return out;
}

function certsFor(app, latestRow) {
  const set = new Set();
  if (latestRow) {
    const apk = JSON.parse(latestRow.assets_json || '[]').find((a) => a.platform === 'android');
    if (apk) {
      const row = getDb().prepare('SELECT sha256 FROM apk_certs WHERE asset_url = ?').get(apk.url);
      if (row?.sha256) set.add(row.sha256);
    }
  }
  for (const fp of String(app.cert_sha256 || '').split(/[,\s]+/)) {
    const n = normalizeFingerprint(fp);
    if (n) set.add(n);
  }
  return [...set];
}

function shapeApp(app, { releaseLimit = 10, admin = false } = {}) {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM releases WHERE app_id = ? ORDER BY published_at DESC LIMIT ?')
    .all(app.id, releaseLimit);
  const latestRow = rows[0] || null;
  const latest = latestRow ? shapeRelease(latestRow) : null;

  const families = new Set();
  if (latest) for (const p of Object.keys(latest.assets)) families.add(PLATFORM_FAMILY[p]);
  if (app.web_url) families.add('web');

  const out = {
    id: app.id,
    name: app.name,
    tagline: app.tagline || '',
    description: app.description || '',
    repo: app.repo || null,
    repoUrl: app.repo ? `https://github.com/${app.repo}` : null,
    packageName: app.package_name || null,
    webUrl: app.web_url || null,
    iconUrl: app.icon_url || null,
    accent: app.accent || '#6366f1',
    sso: !!app.sso && !!app.package_name,
    // Installs older than this must update (null = no requirement).
    minVersion: app.min_version || null,
    platforms: FAMILY_ORDER.filter((f) => families.has(f)),
    latest,
    releases: rows.map((r) => shapeRelease(r, { withAssets: false })),
    certSha256: app.package_name ? certsFor(app, latestRow) : [],
  };
  if (admin) {
    const state = db.prepare('SELECT * FROM sync_state WHERE app_id = ?').get(app.id) || {};
    let certError = null;
    if (latest?.assets.android) {
      certError = db.prepare('SELECT error FROM apk_certs WHERE asset_url = ?').get(latest.assets.android.url)?.error || null;
    }
    out.admin = {
      hidden: !!app.hidden,
      sortOrder: app.sort_order,
      certOverride: app.cert_sha256 || '',
      sso: !!app.sso,
      lastCheckedAt: state.last_checked_at || null,
      lastSuccessAt: state.last_success_at || null,
      lastError: state.last_error || null,
      certError,
    };
  }
  return out;
}

function buildCatalog({ includeHidden = false, admin = false } = {}) {
  // Public: Android apps only (a package name), not hidden. Admin sees every
  // row, so anything left over can still be fixed or deleted.
  const where = includeHidden ? '' : 'WHERE hidden = 0 AND package_name IS NOT NULL';
  const apps = getDb()
    .prepare(`SELECT * FROM apps ${where} ORDER BY sort_order, name COLLATE NOCASE`)
    .all();
  const lastSync = getDb().prepare('SELECT MAX(last_success_at) AS t FROM sync_state').get()?.t || null;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    syncedAt: lastSync,
    apps: apps.map((a) => shapeApp(a, { admin })),
  };
}

/**
 * What an installed app needs to know about itself, looked up by package
 * name (= the Android applicationId = the desktop identifier): the minimum
 * version still allowed, and where to get the latest one.
 */
function getRequirements(packageName) {
  const app = getDb().prepare('SELECT * FROM apps WHERE package_name = ? AND hidden = 0').get(packageName);
  if (!app) return null;
  const row = getDb().prepare('SELECT * FROM releases WHERE app_id = ? ORDER BY published_at DESC LIMIT 1').get(app.id);
  const latest = row ? shapeRelease(row) : null;
  return {
    packageName,
    name: app.name,
    minVersion: app.min_version || null,
    latest: latest
      ? {
          version: latest.version,
          htmlUrl: latest.htmlUrl,
          apkUrl: latest.assets.android?.url || null,
        }
      : null,
  };
}

function getApp(id, { admin = false } = {}) {
  const app = getDb().prepare('SELECT * FROM apps WHERE id = ?').get(id);
  if (!app || (!admin && (app.hidden || !app.package_name))) return null;
  return shapeApp(app, { releaseLimit: 30, admin });
}

module.exports = { buildCatalog, getApp, getRequirements };
