const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  SECRET,
  SESSION_SECS,
  SSO_MINT_CLIENTS,
  now,
  clearCookie,
  cleanText,
  createSession,
  signToken,
  issueLogin,
  revokeSessionTree,
  revokeAllForUser,
  reissueCookie,
} = require('../lib/sessions');

// Lifetime: see SESSION_LIFETIME_DAYS in .env.example. Fixed at login, then
// extended by the sliding renewal in middleware/auth.js on use.

// ── Brute-force guard ──────────────────────────────────────────────────────
// This service is now the one door into every Quarc app, so a little
// friction on repeated wrong passwords is worth it. In-memory and per
// (ip, username): a restart forgets it, which is fine for a home server.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 10;
const failures = new Map();

function failKey(req, username) {
  const ip = req.get('x-real-ip') || req.ip || '';
  return `${ip}|${String(username || '').toLowerCase()}`;
}
function isLockedOut(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > FAIL_WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= FAIL_LIMIT;
}
function recordFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > FAIL_WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else entry.count++;
}
setInterval(() => {
  const cutoff = Date.now() - FAIL_WINDOW_MS;
  for (const [k, v] of failures) if (v.first < cutoff) failures.delete(k);
}, FAIL_WINDOW_MS).unref();

const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role });

// ── Login / register / logout ──────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { username, password, client, device } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const key = failKey(req, username);
  if (isLockedOut(key)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }

  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    recordFailure(key);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  failures.delete(key);

  issueLogin(req, res, user, { client, device });
  res.json(publicUser(user));
});

router.post('/register', async (req, res) => {
  const { username, password, client, device } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (process.env.ALLOW_REGISTRATION === 'false') {
    return res.status(403).json({ error: 'Registration is disabled. Ask the admin for an account.' });
  }
  const name = String(username).trim();
  if (name.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (name.length > 64) return res.status(400).json({ error: 'Username is too long' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const id = uuidv4();
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (id, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, hash, salt, 'user');

  const user = { id, username: name, role: 'user' };
  issueLogin(req, res, user, { client, device });
  res.json(user);
});

router.post('/logout', (req, res) => {
  // Best effort: revoke the session server-side if the token is still valid,
  // but always clear the cookie, even for an expired/invalid token.
  const token = req.cookies?.token;
  if (token) {
    try {
      const claims = jwt.verify(token, SECRET());
      if (claims.sid) revokeSessionTree(claims.sid);
    } catch {
      /* already invalid — nothing to revoke */
    }
  }
  clearCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.dbUser));
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, signOutOthers } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);

  if (signOutOthers) {
    revokeAllForUser(user.id, req.user.sid || null);
    if (req.user.sid) reissueCookie(res, req.dbUser, req.user.sid);
    else clearCookie(res);
  }
  res.json({ ok: true });
});

// ── Finding other users (Quarc Music's friends search) ─────────────────────
// Any signed-in user may look others up by username; only id + username
// are returned. Excludes the caller.
router.get('/users/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const users = getDb()
    .prepare(
      `SELECT id, username FROM users
       WHERE username LIKE ? ESCAPE '\\' AND id != ?
       ORDER BY username COLLATE NOCASE LIMIT 10`
    )
    .all(like, req.user.id);
  res.json(users);
});

// ── Quarc Store single sign-on ─────────────────────────────────────────────
//
// Quarc Store's Android app calls this (natively, with its own token as a
// Bearer header) when another Quarc app on the same device asks the Store
// for a login. The new session is a child of the Store's session: signing
// out of the Store — or revoking it from any device — signs that app out too.

const PACKAGE_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;

router.post('/sso/token', requireAuth, (req, res) => {
  const parent = req.session;
  if (!parent || !SSO_MINT_CLIENTS.includes(parent.client)) {
    return res.status(403).json({ error: 'Only a Quarc Store session can sign in other apps' });
  }
  const client = String(req.body?.client || '');
  if (!PACKAGE_RE.test(client) || client.length > 100) {
    return res.status(400).json({ error: 'client must be an Android package name' });
  }
  const device = cleanText(req.body?.device, 120) || parent.device;

  const db = getDb();
  // At most one live session per app per Store login: a re-mint (e.g. the
  // app was signed out and the user tapped "Continue with Quarc Store")
  // replaces the previous one instead of piling up.
  const previous = db
    .prepare('SELECT id FROM sessions WHERE parent_id = ? AND client = ? AND revoked_at IS NULL')
    .all(parent.id, client);
  for (const p of previous) revokeSessionTree(p.id);

  const sid = createSession(req.dbUser.id, { client, device, parentId: parent.id });
  const token = signToken(req.dbUser, sid, SESSION_SECS);
  res.json({ token, expiresAt: now() + SESSION_SECS, user: publicUser(req.dbUser) });
});

module.exports = router;
