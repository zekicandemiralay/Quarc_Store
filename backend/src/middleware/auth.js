// Admin checks are delegated to quarc-auth itself (GET /api/auth/me with the
// caller's own cookie/token) rather than verifying the JWT locally: that way
// a revoked session or a just-demoted admin is refused immediately. Only the
// admin endpoints pay for this extra hop; the catalog itself is public.

const AUTH_URL = process.env.AUTH_URL || 'http://quarc-auth:3002';

async function whoAmI(req) {
  const headers = {};
  if (req.headers.cookie) headers.Cookie = req.headers.cookie;
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  if (!headers.Cookie && !headers.Authorization) return { status: 401 };
  try {
    const res = await fetch(`${AUTH_URL}/api/auth/me`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { status: res.status === 401 ? 401 : 502 };
    return { status: 200, user: await res.json() };
  } catch {
    return { status: 502 };
  }
}

async function requireAdmin(req, res, next) {
  const who = await whoAmI(req);
  if (who.status === 401) return res.status(401).json({ error: 'Not authenticated' });
  if (who.status !== 200) return res.status(502).json({ error: 'Login service unreachable' });
  if (who.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  req.user = who.user;
  next();
}

module.exports = { requireAdmin, whoAmI };
