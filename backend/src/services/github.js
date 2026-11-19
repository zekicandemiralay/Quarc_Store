// Keeps a local mirror of each catalog app's GitHub releases, so the Store
// (and every device using it) asks this server — not GitHub — what's new.
// That keeps devices well clear of GitHub's 60 requests/hour anonymous limit
// and lets the catalog keep working when GitHub is briefly unreachable.

const { getDb } = require('../db');
const { fetchApkCert } = require('./apkCert');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const SYNC_MINUTES = Math.max(5, Number(process.env.SYNC_INTERVAL_MINUTES || 15));
const RELEASES_PER_APP = 15;

/** Which platform a release asset is for, from its file name. */
function classifyAsset(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.sig') || n === 'latest.json' || n.endsWith('.app.tar.gz')) return null; // updater metadata
  if (n.endsWith('.apk')) return 'android';
  if (n.endsWith('-setup.exe') || n.endsWith('.msi')) return 'windows';
  if (n.endsWith('.exe')) return 'windows';
  if (n.endsWith('.dmg')) return /aarch64|arm64/.test(n) ? 'macos-arm' : 'macos-intel';
  if (n.endsWith('.deb')) return 'linux-deb';
  if (n.endsWith('.appimage')) return 'linux-appimage';
  if (n.endsWith('.rpm')) return 'linux-rpm';
  if (n.endsWith('.zip') && /win|x64|x86|exe/.test(n)) return 'windows';
  return 'other';
}

function versionFromTag(tag) {
  return String(tag || '').replace(/^[vV]/, '');
}

/** Numeric semver-ish comparison: 1.0.10 > 1.0.9. Suffixes are ignored. */
function compareVersions(a, b) {
  const pa = versionFromTag(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = versionFromTag(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function syncApp(app) {
  const db = getDb();
  const state = db.prepare('SELECT * FROM sync_state WHERE app_id = ?').get(app.id);
  const nowIso = new Date().toISOString();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'quarc-store',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  // A 304 (nothing changed) doesn't count against GitHub's rate limit.
  if (state?.etag) headers['If-None-Match'] = state.etag;

  const upsertState = db.prepare(`
    INSERT INTO sync_state (app_id, etag, last_checked_at, last_success_at, last_error)
    VALUES (@app_id, @etag, @checked, @success, @error)
    ON CONFLICT(app_id) DO UPDATE SET
      etag = COALESCE(excluded.etag, sync_state.etag),
      last_checked_at = excluded.last_checked_at,
      last_success_at = COALESCE(excluded.last_success_at, sync_state.last_success_at),
      last_error = excluded.last_error
  `);

  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${app.repo}/releases?per_page=${RELEASES_PER_APP}`, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    upsertState.run({ app_id: app.id, etag: null, checked: nowIso, success: null, error: `GitHub unreachable: ${err.message}` });
    return;
  }

  if (res.status === 304) {
    upsertState.run({ app_id: app.id, etag: null, checked: nowIso, success: nowIso, error: null });
    return;
  }
  if (!res.ok) {
    const msg =
      res.status === 404
        ? `Repository ${app.repo} not found (or private)`
        : res.status === 403 || res.status === 429
          ? 'GitHub rate limit hit — set GITHUB_TOKEN in .env'
          : `GitHub returned HTTP ${res.status}`;
    upsertState.run({ app_id: app.id, etag: null, checked: nowIso, success: null, error: msg });
    return;
  }

  const list = await res.json();
  const releases = (Array.isArray(list) ? list : [])
    .filter((r) => !r.draft && !r.prerelease)
    .map((r) => ({
      tag: r.tag_name,
      version: versionFromTag(r.tag_name),
      name: r.name || r.tag_name,
      body: r.body || '',
      published_at: r.published_at || r.created_at,
      html_url: r.html_url,
      assets: (r.assets || [])
        .map((a) => ({
          name: a.name,
          url: a.browser_download_url,
          size: a.size,
          platform: classifyAsset(a.name),
          updatedAt: a.updated_at,
        }))
        .filter((a) => a.platform),
    }));

  db.transaction(() => {
    db.prepare('DELETE FROM releases WHERE app_id = ?').run(app.id);
    const ins = db.prepare(`
      INSERT INTO releases (app_id, tag, version, name, body, published_at, html_url, assets_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of releases) {
      ins.run(app.id, r.tag, r.version, r.name, r.body, r.published_at, r.html_url, JSON.stringify(r.assets));
    }
    upsertState.run({ app_id: app.id, etag: res.headers.get('etag'), checked: nowIso, success: nowIso, error: null });
  })();
}

/** Latest release's APK for each Android app → its signing-cert fingerprint. */
async function computeMissingCerts() {
  const db = getDb();
  const apps = db.prepare('SELECT id FROM apps WHERE package_name IS NOT NULL').all();
  for (const { id } of apps) {
    const latest = db
      .prepare('SELECT assets_json FROM releases WHERE app_id = ? ORDER BY published_at DESC LIMIT 1')
      .get(id);
    if (!latest) continue;
    const apk = JSON.parse(latest.assets_json).find((a) => a.platform === 'android');
    if (!apk) continue;
    const known = db.prepare('SELECT sha256, error, computed_at FROM apk_certs WHERE asset_url = ?').get(apk.url);
    // Retry failures once a day; successes are permanent for that asset.
    if (known && (known.sha256 || Date.now() - Date.parse(known.computed_at + 'Z') < 86400000)) continue;
    try {
      const sha256 = await fetchApkCert(apk.url);
      db.prepare(
        `INSERT INTO apk_certs (asset_url, sha256, error, computed_at) VALUES (?, ?, NULL, datetime('now'))
         ON CONFLICT(asset_url) DO UPDATE SET sha256 = excluded.sha256, error = NULL, computed_at = excluded.computed_at`
      ).run(apk.url, sha256);
      console.log(`[certs] ${id}: ${sha256}`);
    } catch (err) {
      db.prepare(
        `INSERT INTO apk_certs (asset_url, sha256, error, computed_at) VALUES (?, NULL, ?, datetime('now'))
         ON CONFLICT(asset_url) DO UPDATE SET error = excluded.error, computed_at = excluded.computed_at`
      ).run(apk.url, err.message);
      console.warn(`[certs] ${id}: ${err.message}`);
    }
  }
}

let running = null;

/** Syncs every app (sequentially, to be gentle on GitHub). Coalesces concurrent calls. */
let releasesDone = Promise.resolve(); // settles when the current run's release data is fresh
let lastStartedAt = 0;

function syncAll() {
  if (running) return running;
  lastStartedAt = Date.now();
  let markReleasesDone;
  releasesDone = new Promise((resolve) => {
    markReleasesDone = resolve;
  });
  running = (async () => {
    try {
      const apps = getDb().prepare('SELECT id, repo FROM apps WHERE repo IS NOT NULL AND repo != ?').all('');
      for (const app of apps) {
        try {
          await syncApp(app);
        } catch (err) {
          console.warn(`[sync] ${app.id}: ${err.message}`);
        }
      }
    } finally {
      markReleasesDone();
    }
    // Slower (downloads APKs) — nobody needs to wait for it.
    await computeMissingCerts();
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * For someone asking "is there anything new?" (opening the Store, "Check
 * now"): if GitHub hasn't been asked in the last maxAgeMs, ask now and wait
 * until the release data is fresh — at most timeoutMs, then answer with what
 * we have while the check finishes in the background. Throttled, so many
 * devices opening the Store at once cost at most one GitHub round per
 * maxAgeMs (and unchanged repos answer 304, which GitHub doesn't count).
 */
async function refreshIfStale({ maxAgeMs = 2 * 60 * 1000, timeoutMs = 10000 } = {}) {
  if (!running && Date.now() - lastStartedAt < maxAgeMs) return;
  if (!running) syncAll().catch(() => {});
  let timer;
  await Promise.race([releasesDone, new Promise((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
  clearTimeout(timer);
}

function startSyncLoop() {
  syncAll();
  setInterval(syncAll, SYNC_MINUTES * 60 * 1000).unref();
  console.log(`Release sync every ${SYNC_MINUTES} min${GITHUB_TOKEN ? ' (authenticated)' : ''}.`);
}

module.exports = { syncAll, syncApp, refreshIfStale, computeMissingCerts, startSyncLoop, classifyAsset, compareVersions, versionFromTag };
