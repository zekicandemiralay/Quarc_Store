const jwt = require('jsonwebtoken');
const { SECRET, SECURE_COOKIE, checkClaims, clearCookie } = require('../lib/sessions');

// Sliding session — identical copy in every app's own requireAuth (Quarc
// Music, Quarc Notes, ...) and intentionally so; see the comment there for
// the full reasoning. This copy matters most of all: GET /api/auth/me is what
// every app's checkSession() calls on launch, so this fires on literally
// every app open — the single most reliable place for a session to get
// extended. Extra claims (like sid) are carried over unchanged.
const MAX_COOKIE_DAYS = 400;

function renewIfStale(req, res, user) {
  if (!user.iat || !user.exp) return;
  // Native callers (Quarc Store minting via Bearer) don't hold a cookie jar
  // to receive a renewal in.
  if (req.authVia !== 'cookie') return;
  const now = Math.floor(Date.now() / 1000);
  const lifetime = user.exp - user.iat;
  const elapsed = now - user.iat;
  if (lifetime <= 0 || elapsed < lifetime / 2) return;

  const freshLifetimeSecs = Math.min(lifetime, MAX_COOKIE_DAYS * 86400);
  const { iat, exp, ...claims } = user;
  const token = jwt.sign(claims, SECRET(), { expiresIn: freshLifetimeSecs });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: SECURE_COOKIE ? 'none' : 'lax',
    secure: SECURE_COOKIE,
    maxAge: freshLifetimeSecs * 1000,
  });
}

function readToken(req) {
  if (req.cookies?.token) {
    req.authVia = 'cookie';
    return req.cookies.token;
  }
  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) {
    req.authVia = 'bearer';
    return m[1].trim();
  }
  return null;
}

function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  let claims;
  try {
    claims = jwt.verify(token, SECRET());
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
  const check = checkClaims(claims);
  if (!check.ok) {
    // Revoked from another device / by an admin: make the client forget it.
    if (req.authVia === 'cookie') clearCookie(res);
    return res.status(401).json({ error: check.error });
  }
  req.user = { ...claims, role: check.user.role, username: check.user.username };
  req.dbUser = check.user;
  req.session = check.session;
  renewIfStale(req, res, claims);
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.dbUser.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
