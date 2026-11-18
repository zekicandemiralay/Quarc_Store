// "Sign in with your phone": sign in on a computer (any Quarc app's web or
// desktop login page) by approving it in Quarc Store on your phone.
//
//   computer  POST /api/auth/approval/start {username}  → { id, secret, number }
//             shows the 2-digit number, polls POST /approval/poll {id, secret}
//   phone     Quarc Store sees GET /approval/pending, the user types the
//             number → POST /approval/:id/approve {number}
//   computer  the next poll returns { status: 'approved' } and sets the
//             login cookie, exactly like a password login would
//
// Only a Quarc Store session (the phone) can approve. One wrong number blocks
// the request, so it can't be approved by guessing or by an absent-minded tap.
// The start response looks the same whether or not the username exists.

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { STORE_CLIENT, now, issueLogin, describeDevice, describeClient } = require('../lib/sessions');

const TTL_SECS = 120;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Per-IP limit on starting requests: each one pops up on someone's phone.
const START_WINDOW_MS = 10 * 60 * 1000;
const START_LIMIT = 10;
const starts = new Map();
function rateLimited(req) {
  const ip = req.get('x-real-ip') || req.ip || '';
  const t = Date.now();
  const recent = (starts.get(ip) || []).filter((x) => t - x < START_WINDOW_MS);
  recent.push(t);
  starts.set(ip, recent);
  return recent.length > START_LIMIT;
}
setInterval(() => {
  const cutoff = Date.now() - START_WINDOW_MS;
  for (const [ip, list] of starts) if (!list.some((x) => x > cutoff)) starts.delete(ip);
}, START_WINDOW_MS).unref();

function requireStore(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session?.client !== STORE_CLIENT) {
      return res.status(403).json({ error: 'Only Quarc Store on your phone can approve sign-ins' });
    }
    next();
  });
}

router.post('/start', (req, res) => {
  if (rateLimited(req)) return res.status(429).json({ error: 'Too many sign-in requests. Try again in a few minutes.' });
  const username = String(req.body?.username || '').trim();
  if (!username) return res.status(400).json({ error: 'Username required' });

  const user = getDb().prepare('SELECT id FROM users WHERE username = ?').get(username);
  const id = uuidv4();
  const secret = crypto.randomBytes(32).toString('hex');
  const number = crypto.randomInt(10, 100);
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO login_requests (id, secret_hash, user_id, number, client, device, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, sha256(secret), user?.id || null, number, describeClient(req), describeDevice(req), t, t + TTL_SECS);
  res.json({ id, secret, number, expiresAt: t + TTL_SECS });
});

router.post('/poll', (req, res) => {
  const { id, secret } = req.body || {};
  const row = id && secret ? getDb().prepare('SELECT * FROM login_requests WHERE id = ?').get(String(id)) : null;
  const given = sha256(String(secret || ''));
  if (!row || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(row.secret_hash))) {
    return res.status(404).json({ error: 'Unknown request' });
  }
  if (row.status === 'denied') return res.json({ status: 'denied' });
  if (row.status === 'used' || now() > row.expires_at) return res.json({ status: 'expired' });
  if (row.status === 'pending') return res.json({ status: 'pending', expiresAt: row.expires_at });

  // Approved: hand this browser its login, exactly once.
  const claimed = getDb().prepare("UPDATE login_requests SET status = 'used' WHERE id = ? AND status = 'approved'").run(row.id);
  if (!claimed.changes) return res.json({ status: 'expired' });
  const user = getDb().prepare('SELECT id, username, role FROM users WHERE id = ?').get(row.user_id);
  if (!user) return res.json({ status: 'expired' });
  issueLogin(req, res, user, {});
  res.json({ status: 'approved', user });
});

// ── Phone side (Quarc Store) ───────────────────────────────────────────────

router.get('/pending', requireStore, (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, client, device, created_at AS createdAt, expires_at AS expiresAt
       FROM login_requests
       WHERE user_id = ? AND status = 'pending' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 5`
    )
    .all(req.user.id, now());
  res.json(rows);
});

function pendingFor(req, res) {
  const row = getDb().prepare('SELECT * FROM login_requests WHERE id = ?').get(req.params.id);
  if (!row || row.user_id !== req.user.id) {
    res.status(404).json({ error: 'Request not found' });
    return null;
  }
  if (row.status !== 'pending' || now() > row.expires_at) {
    res.status(410).json({ error: 'This request has expired' });
    return null;
  }
  return row;
}

router.post('/:id/approve', requireStore, (req, res) => {
  const row = pendingFor(req, res);
  if (!row) return;
  if (Number(req.body?.number) !== row.number) {
    getDb().prepare("UPDATE login_requests SET status = 'denied' WHERE id = ?").run(row.id);
    return res.status(400).json({ error: "That's not the number on the other screen — the request was blocked." });
  }
  getDb().prepare("UPDATE login_requests SET status = 'approved' WHERE id = ? AND status = 'pending'").run(row.id);
  res.json({ ok: true });
});

router.post('/:id/deny', requireStore, (req, res) => {
  const row = pendingFor(req, res);
  if (!row) return;
  getDb().prepare("UPDATE login_requests SET status = 'denied' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

module.exports = router;
