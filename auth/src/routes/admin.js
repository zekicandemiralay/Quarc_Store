// Account administration for the whole Quarc suite — the single place users
// are managed now that every app shares this service. Admin only.

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { revokeAllForUser } = require('../lib/sessions');
const { listSessions } = require('./sessions');

router.use(requireAdmin);

const ROLES = ['user', 'admin'];

function adminCount() {
  return getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
}

// A plain array with snake_case created_at: Quarc Music's admin page proxies
// this response to its frontend unchanged and expects exactly that shape.
router.get('/users', (_req, res) => {
  const users = getDb()
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS sessions,
              (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS lastSeenAt
       FROM users u ORDER BY u.username COLLATE NOCASE`
    )
    .all();
  res.json(users);
});

router.get('/users/:id/sessions', (req, res) => {
  const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ sessions: listSessions(user.id) });
});

router.post('/users', async (req, res) => {
  const { username, password, role = 'user' } = req.body || {};
  const name = String(username || '').trim();
  if (name.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (String(password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(name)) {
    return res.status(409).json({ error: 'Username already taken' });
  }
  const id = uuidv4();
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (id, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, hash, salt, role);
  res.status(201).json({ id, username: name, role });
});

router.patch('/users/:id', async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { role, password, username } = req.body || {};

  if (role !== undefined) {
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (user.role === 'admin' && role !== 'admin' && adminCount() <= 1) {
      return res.status(400).json({ error: "Can't remove the last admin" });
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  }
  if (username !== undefined) {
    const name = String(username).trim();
    if (name.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
    const clash = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(name, user.id);
    if (clash) return res.status(409).json({ error: 'Username already taken' });
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, user.id);
  }
  if (password !== undefined) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    // A reset password means "whoever had it shouldn't stay logged in".
    if (user.id !== req.user.id) revokeAllForUser(user.id);
  }
  const updated = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(user.id);
  res.json(updated);
});

// Used by Quarc Music's admin page (body: { newPassword }). Same effect as
// PATCH /users/:id { password }: the user is signed out everywhere.
router.post('/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body || {};
  if (String(newPassword || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  if (user.id !== req.user.id) revokeAllForUser(user.id);
  res.json({ ok: true });
});

router.post('/users/:id/revoke-sessions', (req, res) => {
  const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) {
    return res.status(400).json({ error: 'Use "Sign out everywhere" in your own account instead' });
  }
  revokeAllForUser(user.id);
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account" });
  if (user.role === 'admin' && adminCount() <= 1) return res.status(400).json({ error: "Can't delete the last admin" });
  db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  })();
  // Note: each app keeps its own per-user data (playlists, notes, ...) keyed
  // by this user id; deleting the account only removes the ability to log in.
  res.json({ ok: true });
});

module.exports = router;
