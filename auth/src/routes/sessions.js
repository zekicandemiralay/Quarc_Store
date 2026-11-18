// A user's own logins: list them, sign one out, or sign out everywhere.
// Mounted under /api/auth so every Quarc app's existing nginx rule for
// /api/auth/* already reaches it — no per-app config needed.

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { revokeSessionTree, revokeAllForUser, reissueCookie, clearCookie } = require('../lib/sessions');

function listSessions(userId) {
  return getDb()
    .prepare(
      `SELECT id, parent_id AS parentId, client, device, created_at AS createdAt, last_seen_at AS lastSeenAt
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY last_seen_at DESC`
    )
    .all(userId);
}

router.get('/sessions', requireAuth, (req, res) => {
  const sessions = listSessions(req.user.id).map((s) => ({ ...s, current: s.id === req.user.sid }));
  res.json({ sessions, legacy: !req.user.sid });
});

router.delete('/sessions/:id', requireAuth, (req, res) => {
  const row = getDb().prepare('SELECT id, user_id FROM sessions WHERE id = ?').get(req.params.id);
  if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Session not found' });
  const revoked = revokeSessionTree(row.id);
  if (row.id === req.user.sid) clearCookie(res);
  res.json({ ok: true, revoked });
});

// "Sign out everywhere". keepCurrent (default true) keeps this session — and
// the apps it signed in on this device — logged in.
router.post('/sessions/revoke-all', requireAuth, (req, res) => {
  const keepCurrent = req.body?.keepCurrent !== false && !!req.user.sid;
  revokeAllForUser(req.user.id, keepCurrent ? req.user.sid : null);
  if (keepCurrent) reissueCookie(res, req.dbUser, req.user.sid);
  else clearCookie(res);
  res.json({ ok: true, keptCurrent: keepCurrent });
});

module.exports = { router, listSessions };
