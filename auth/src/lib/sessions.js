// Session bookkeeping shared by every route: issuing tokens, checking
// whether a presented token's session is still alive, and revoking.
//
// Design constraint: every Quarc app's own backend verifies the JWT locally
// (same JWT_SECRET, no network call). Revocation therefore takes effect the
// next time a client calls GET /api/auth/me — which every app's
// checkSession() does on each launch — rather than on every API request.

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const SECRET = () => process.env.JWT_SECRET || 'insecure-default-change-in-production';
const SECURE_COOKIE = process.env.SECURE_COOKIE === 'true';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

// See .env.example for why this is capped well under 400 days.
const SESSION_DAYS = Number(process.env.SESSION_LIFETIME_DAYS || 365);
const SESSION_SECS = SESSION_DAYS * 24 * 60 * 60;

// The client label Quarc Store's Android app logs in with. Only sessions
// carrying it may mint sessions for other apps (POST /api/auth/sso/token).
const STORE_CLIENT = 'quarc-store';

// Quarc Store on Windows logs in with its own label. It may mint sessions for the Quarc apps on the same PC
// (single sign-on, like the Android Store), but it is deliberately NOT STORE_CLIENT: only the phone's Store
// may approve another computer's sign-in (routes/approval.js).
const STORE_WINDOWS_CLIENT = 'quarc-store-windows';
const SSO_MINT_CLIENTS = [STORE_CLIENT, STORE_WINDOWS_CLIENT];

// Where a browser login came from, keyed by the port in its Origin header —
// purely a display label for the sessions list. Overridable via APP_PORTS,
// e.g. "4000=Quarc Music,4001=Quarc Notes".
const DEFAULT_APP_PORTS = {
  4000: 'Quarc Music',
  4001: 'Quarc Notes',
  4002: 'Quarc Weather',
  4003: 'Quarc Translate',
  4005: 'Quarc Calendar',
  4006: 'Quarc Store',
  4007: 'Quarc Sport',
  4008: 'Quarc Reader',
  4009: 'Quarc Draw',
};

function appPorts() {
  if (!process.env.APP_PORTS) return DEFAULT_APP_PORTS;
  const map = {};
  for (const pair of process.env.APP_PORTS.split(',')) {
    const [port, name] = pair.split('=').map((s) => s && s.trim());
    if (port && name) map[port] = name;
  }
  return map;
}

const now = () => Math.floor(Date.now() / 1000);

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    // SameSite=none is required when an APK (https://localhost) or another
    // app's origin sends requests to this shared service cross-origin.
    sameSite: SECURE_COOKIE ? 'none' : 'lax',
    secure: SECURE_COOKIE,
    domain: COOKIE_DOMAIN,
    maxAge: maxAgeMs,
  };
}

function clearCookie(res) {
  res.clearCookie('token', {
    httpOnly: true,
    sameSite: SECURE_COOKIE ? 'none' : 'lax',
    secure: SECURE_COOKIE,
    domain: COOKIE_DOMAIN,
  });
}

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return v ? v.slice(0, max) : null;
}

/** Short human label for a device, from an explicit value or the User-Agent. */
function describeDevice(req, explicit) {
  const given = cleanText(explicit, 120);
  if (given) return given;
  const ua = req.get('user-agent') || '';
  const android = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?[;)]/);
  if (android) return android[1].trim();
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  if (os && browser) return `${browser} on ${os}`;
  return os || browser || null;
}

/** Which client a login came from (display only — never trusted for access). */
function describeClient(req, explicit) {
  const given = cleanText(explicit, 100);
  if (given && /^[\w.-]+$/.test(given)) return given;
  const origin = req.get('origin') || '';
  const m = origin.match(/^https?:\/\/[^/:]+(?::(\d+))?/);
  if (m && m[1] && appPorts()[m[1]]) return appPorts()[m[1]];
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return 'Android app';
  return 'web';
}

function createSession(userId, { client = 'web', device = null, parentId = null } = {}) {
  const id = uuidv4();
  const t = now();
  getDb()
    .prepare(
      'INSERT INTO sessions (id, user_id, parent_id, client, device, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(id, userId, parentId, client, device, t, t);
  return id;
}

function signToken(user, sid, lifetimeSecs = SESSION_SECS) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, sid }, SECRET(), {
    expiresIn: lifetimeSecs,
  });
}

/** Creates a session for a fresh login and sets the cookie. */
function issueLogin(req, res, user, { client, device } = {}) {
  const sid = createSession(user.id, {
    client: describeClient(req, client),
    device: describeDevice(req, device),
  });
  const token = signToken(user, sid);
  res.cookie('token', token, cookieOptions(SESSION_SECS * 1000));
  return { sid, token };
}

/**
 * Is the session behind these (already signature-verified) claims still
 * alive? Returns the current DB user on success, so callers see role changes
 * immediately rather than whatever the token was signed with.
 */
function checkClaims(claims) {
  const db = getDb();
  const user = db
    .prepare('SELECT id, username, role, tokens_valid_after FROM users WHERE id = ?')
    .get(claims.id);
  if (!user) return { ok: false, error: 'User not found' };
  if (user.tokens_valid_after && claims.iat && claims.iat < user.tokens_valid_after) {
    return { ok: false, error: 'Session revoked' };
  }
  let session = null;
  if (claims.sid) {
    session = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(claims.sid, user.id);
    if (!session || session.revoked_at) return { ok: false, error: 'Session revoked' };
    // Throttled so a busy client doesn't turn every request into a write.
    if (now() - session.last_seen_at > 60) {
      db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), session.id);
    }
  }
  const { tokens_valid_after: _tva, ...publicUser } = user;
  return { ok: true, user: publicUser, session };
}

/** Revokes a session and everything minted from it (any depth). */
function revokeSessionTree(sid) {
  return getDb()
    .prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE revoked_at IS NULL AND id IN (
         WITH RECURSIVE tree(id) AS (
           SELECT ?
           UNION
           SELECT s.id FROM sessions s JOIN tree t ON s.parent_id = t.id
         )
         SELECT id FROM tree
       )`
    )
    .run(now(), sid).changes;
}

/**
 * Revokes every session of a user — and, via tokens_valid_after, every
 * pre-v2 token without a sid. If keepSid is given, that session survives;
 * the caller must re-issue its cookie (its token's iat is now too old).
 */
function revokeAllForUser(userId, keepSid = null) {
  const db = getDb();
  const t = now();
  const tx = db.transaction(() => {
    if (keepSid) {
      // Keep the current session and its own children (e.g. the apps the
      // Store on *this* device signed in) — "sign out everywhere else".
      db.prepare(
        `UPDATE sessions SET revoked_at = ?
         WHERE user_id = ? AND revoked_at IS NULL AND id NOT IN (
           WITH RECURSIVE tree(id) AS (
             SELECT ?
             UNION
             SELECT s.id FROM sessions s JOIN tree t ON s.parent_id = t.id
           )
           SELECT id FROM tree
         )`
      ).run(t, userId, keepSid);
    } else {
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(t, userId);
    }
    // Cuts off pre-v2 tokens (no sid) issued before now. Tokens with a sid
    // are already handled by the revoked_at update above.
    db.prepare('UPDATE users SET tokens_valid_after = ? WHERE id = ?').run(t, userId);
  });
  tx();
}

/** Re-issues the cookie for a session that must survive a revoke-all. */
function reissueCookie(res, user, sid) {
  // iat must be >= tokens_valid_after, which was just set to now().
  const token = signToken(user, sid);
  res.cookie('token', token, cookieOptions(SESSION_SECS * 1000));
  return token;
}

function pruneSessions() {
  const t = now();
  const db = getDb();
  const revoked = db.prepare('DELETE FROM sessions WHERE revoked_at IS NOT NULL AND revoked_at < ?').run(t - 30 * 86400).changes;
  const stale = db.prepare('DELETE FROM sessions WHERE revoked_at IS NULL AND last_seen_at < ?').run(t - SESSION_SECS - 30 * 86400).changes;
  db.prepare('DELETE FROM login_requests WHERE created_at < ?').run(t - 86400);
  if (revoked || stale) console.log(`Pruned ${revoked} revoked and ${stale} stale session(s).`);
}

module.exports = {
  SECRET,
  SECURE_COOKIE,
  SESSION_SECS,
  STORE_CLIENT,
  STORE_WINDOWS_CLIENT,
  SSO_MINT_CLIENTS,
  now,
  cookieOptions,
  clearCookie,
  cleanText,
  describeDevice,
  describeClient,
  createSession,
  signToken,
  issueLogin,
  checkClaims,
  revokeSessionTree,
  revokeAllForUser,
  reissueCookie,
  pruneSessions,
};
