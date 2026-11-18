// Catalog administration: which apps the Store lists and how.

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { buildCatalog, getApp } = require('../services/catalog');
const { syncAll, compareVersions } = require('../services/github');
const { isBlocked } = require('../seed');
const { normalizeFingerprint } = require('../services/apkCert');

router.use(requireAdmin);

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PACKAGE_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const URL_RE = /^https?:\/\/\S+$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const VERSION_RE = /^\d+(\.\d+){0,3}$/;

/** Latest published version of an app, or null if nothing is synced yet. */
function latestVersion(appId) {
  return getDb().prepare('SELECT version FROM releases WHERE app_id = ? ORDER BY published_at DESC LIMIT 1').get(appId)?.version || null;
}

/** A minimum version newer than anything released would lock everyone out. */
function checkMinVersion(appId, minVersion) {
  if (!minVersion) return null;
  const latest = latestVersion(appId);
  if (latest && compareVersions(minVersion, latest) > 0) {
    return `The minimum version can't be newer than the latest release (v${latest}) — nobody could update to it`;
  }
  return null;
}

/** Validates and normalises admin input; returns { error } or { values }. */
function validate(body, { creating }) {
  const v = {};
  const str = (k, max = 500) => {
    if (body[k] === undefined) return;
    v[k] = body[k] === null || body[k] === '' ? null : String(body[k]).trim().slice(0, max);
  };
  if (creating) {
    if (!ID_RE.test(String(body.id || ''))) return { error: 'id must be lowercase letters, digits or dashes' };
    v.id = body.id;
  }
  str('name', 80);
  if (creating && !v.name) return { error: 'name is required' };
  if (v.name === null) return { error: 'name is required' };
  str('tagline', 160);
  str('description', 4000);
  str('repo', 140);
  if (v.repo && !REPO_RE.test(v.repo)) return { error: 'repo must look like owner/name' };
  str('package_name', 120);
  // The Store lists Android apps only.
  if ((creating && !v.package_name) || v.package_name === null) {
    return { error: 'An Android package name is required — the Store only lists Android apps' };
  }
  if (v.package_name && !PACKAGE_RE.test(v.package_name)) return { error: 'Invalid Android package name' };
  str('web_url', 300);
  if (v.web_url && !URL_RE.test(v.web_url)) return { error: 'web_url must be an http(s) URL' };
  str('icon_url', 500);
  if (v.icon_url && !URL_RE.test(v.icon_url)) return { error: 'icon_url must be an http(s) URL' };
  str('accent', 7);
  if (v.accent && !COLOR_RE.test(v.accent)) return { error: 'accent must be a #rrggbb colour' };
  if (body.cert_sha256 !== undefined) {
    const parts = String(body.cert_sha256 || '').split(/[,\s]+/).filter(Boolean);
    const norm = parts.map(normalizeFingerprint);
    if (norm.some((x) => !x)) return { error: 'Fingerprints must be SHA-256 (64 hex characters each)' };
    v.cert_sha256 = norm.join(',') || null;
  }
  str('min_version', 20);
  if (v.min_version) v.min_version = v.min_version.replace(/^[vV]/, '');
  if (v.min_version && !VERSION_RE.test(v.min_version)) return { error: 'Minimum version must look like 1.2.3' };
  if (body.sso !== undefined) v.sso = body.sso ? 1 : 0;
  if (body.hidden !== undefined) v.hidden = body.hidden ? 1 : 0;
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    if (!Number.isInteger(n)) return { error: 'sort_order must be an integer' };
    v.sort_order = n;
  }
  return { values: v };
}

router.get('/apps', (_req, res) => {
  res.json(buildCatalog({ includeHidden: true, admin: true }));
});

router.post('/apps', (req, res) => {
  const { error, values } = validate(req.body || {}, { creating: true });
  if (error) return res.status(400).json({ error });
  if (isBlocked(values)) return res.status(400).json({ error: 'This app cannot be listed in Quarc Store.' });
  const db = getDb();
  if (db.prepare('SELECT id FROM apps WHERE id = ?').get(values.id)) return res.status(409).json({ error: 'An app with this id exists' });
  if (values.package_name && db.prepare('SELECT id FROM apps WHERE package_name = ?').get(values.package_name)) {
    return res.status(409).json({ error: 'Another app already uses this package name' });
  }
  const cols = Object.keys(values);
  db.prepare(`INSERT INTO apps (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`).run(values);
  syncAll().catch(() => {});
  res.status(201).json(getApp(values.id, { admin: true }));
});

router.patch('/apps/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'App not found' });
  const { error, values } = validate(req.body || {}, { creating: false });
  if (error) return res.status(400).json({ error });
  if (isBlocked({ ...existing, ...values })) {
    return res.status(400).json({ error: 'This app cannot be listed in Quarc Store.' });
  }
  const minError = checkMinVersion(existing.id, values.min_version);
  if (minError) return res.status(400).json({ error: minError });
  if (values.package_name && db.prepare('SELECT id FROM apps WHERE package_name = ? AND id != ?').get(values.package_name, existing.id)) {
    return res.status(409).json({ error: 'Another app already uses this package name' });
  }
  const cols = Object.keys(values);
  if (cols.length) {
    db.prepare(`UPDATE apps SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now') WHERE id = @__id`).run({
      ...values,
      __id: existing.id,
    });
  }
  if (values.repo !== undefined && values.repo !== existing.repo) {
    db.prepare('DELETE FROM releases WHERE app_id = ?').run(existing.id);
    db.prepare('DELETE FROM sync_state WHERE app_id = ?').run(existing.id);
    syncAll().catch(() => {});
  }
  res.json(getApp(existing.id, { admin: true }));
});

router.delete('/apps/:id', (req, res) => {
  const db = getDb();
  const info = db.transaction(() => {
    db.prepare('DELETE FROM releases WHERE app_id = ?').run(req.params.id);
    db.prepare('DELETE FROM sync_state WHERE app_id = ?').run(req.params.id);
    return db.prepare('DELETE FROM apps WHERE id = ?').run(req.params.id);
  })();
  if (!info.changes) return res.status(404).json({ error: 'App not found' });
  res.json({ ok: true });
});

router.post('/refresh', async (_req, res) => {
  try {
    await Promise.race([syncAll(), new Promise((r) => setTimeout(r, 60000))]);
  } catch {
    /* per-app errors are recorded in sync_state */
  }
  res.json(buildCatalog({ includeHidden: true, admin: true }));
});

module.exports = router;
