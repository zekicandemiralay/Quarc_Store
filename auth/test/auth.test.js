// End-to-end test of quarc-auth v2 against a throwaway database.
// Run: npm test   (from Quarc_Store/auth)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-auth-test-'));
process.env.DB_PATH = path.join(tmp, 'auth.db');
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin-password';
process.env.SECURE_COOKIE = 'false';

const jwt = require('jsonwebtoken');
const app = require('../src/index');

let base;
const server = app.listen(0, () => {
  base = `http://127.0.0.1:${server.address().port}`;
  run()
    .then(() => {
      console.log('\nAll quarc-auth tests passed.');
      server.close();
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nTEST FAILED:', err);
      server.close();
      process.exit(1);
    });
});

function cookieFrom(res) {
  const set = res.headers.getSetCookie?.() || [];
  const tok = set.find((c) => c.startsWith('token='));
  return tok ? tok.split(';')[0] : null;
}

async function call(method, url, { cookie, bearer, body, origin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (origin) headers.Origin = origin;
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json, cookie: cookieFrom(res) };
}

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);

async function run() {
  // Register + login from a "web app"
  let r = await call('POST', '/api/auth/register', { body: { username: 'alice', password: 'password1' }, origin: 'https://host:4000' });
  assert.equal(r.status, 200);
  const aliceWeb = r.cookie;
  assert.ok(jwt.decode(aliceWeb.slice(6)).sid, 'token carries a sid');
  ok('register issues a token with a session id');

  r = await call('GET', '/api/auth/me', { cookie: aliceWeb });
  assert.equal(r.status, 200);
  assert.equal(r.json.username, 'alice');
  ok('/me accepts the new session');

  // Brute-force guard
  for (let i = 0; i < 10; i++) await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'wrong' } });
  r = await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'password1' } });
  assert.equal(r.status, 429);
  ok('login is rate limited after 10 failures');

  // Store login (different "ip" so the lockout above doesn't apply)
  const storeLogin = async () => {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': '10.0.0.2' },
      body: JSON.stringify({ username: 'alice', password: 'password1', client: 'quarc-store', device: 'Pixel Test' }),
    });
    return cookieFrom(res);
  };
  const storeCookie = await storeLogin();
  const storeToken = storeCookie.slice(6);
  ok('store logs in with client=quarc-store');

  // A plain web session must not be able to mint
  r = await call('POST', '/api/auth/sso/token', { cookie: aliceWeb, body: { client: 'com.quarc.music' } });
  assert.equal(r.status, 403);
  ok('non-store sessions cannot mint app sessions');

  r = await call('POST', '/api/auth/sso/token', { bearer: storeToken, body: { client: 'not a package' } });
  assert.equal(r.status, 400);
  ok('mint rejects invalid package names');

  r = await call('POST', '/api/auth/sso/token', { bearer: storeToken, body: { client: 'com.quarc.music' } });
  assert.equal(r.status, 200);
  const musicToken = r.json.token;
  assert.equal(r.json.user.username, 'alice');
  r = await call('GET', '/api/auth/me', { cookie: `token=${musicToken}` });
  assert.equal(r.status, 200);
  ok('store mints a working per-app token via Bearer');

  // Re-mint replaces the previous child
  r = await call('POST', '/api/auth/sso/token', { bearer: storeToken, body: { client: 'com.quarc.music' } });
  const musicToken2 = r.json.token;
  r = await call('GET', '/api/auth/me', { cookie: `token=${musicToken}` });
  assert.equal(r.status, 401);
  r = await call('GET', '/api/auth/me', { cookie: `token=${musicToken2}` });
  assert.equal(r.status, 200);
  ok('re-minting for the same app revokes the previous app session');

  r = await call('POST', '/api/auth/sso/token', { bearer: storeToken, body: { client: 'com.quarc.notes' } });
  const notesToken = r.json.token;

  // Sessions list shows the tree
  r = await call('GET', '/api/auth/sessions', { cookie: storeCookie });
  assert.equal(r.status, 200);
  const storeSid = jwt.decode(storeToken).sid;
  const children = r.json.sessions.filter((s) => s.parentId === storeSid).map((s) => s.client).sort();
  assert.deepEqual(children, ['com.quarc.music', 'com.quarc.notes']);
  assert.ok(r.json.sessions.find((s) => s.id === storeSid).current);
  ok('sessions list shows store + its app children');

  // App logout revokes only that app
  r = await call('POST', '/api/auth/logout', { cookie: `token=${notesToken}` });
  r = await call('GET', '/api/auth/me', { cookie: `token=${notesToken}` });
  assert.equal(r.status, 401);
  r = await call('GET', '/api/auth/me', { cookie: `token=${musicToken2}` });
  assert.equal(r.status, 200);
  ok('logging out of one app leaves the others signed in');

  // Store logout cascades
  r = await call('POST', '/api/auth/logout', { cookie: storeCookie });
  r = await call('GET', '/api/auth/me', { cookie: `token=${musicToken2}` });
  assert.equal(r.status, 401);
  r = await call('GET', '/api/auth/me', { cookie: aliceWeb });
  assert.equal(r.status, 200);
  // (Apps on the same phone that were signed in on their own are signed out
  // on the device by the SSO kit; this only checks the server side.)
  ok('store logout revokes every app session it minted; logins on other devices stay');

  // Sign out everywhere (keep current)
  const store2 = await storeLogin();
  r = await call('POST', '/api/auth/sso/token', { bearer: store2.slice(6), body: { client: 'com.quarc.music' } });
  const music3 = r.json.token;
  r = await call('POST', '/api/auth/sessions/revoke-all', { cookie: store2, body: { keepCurrent: true } });
  assert.equal(r.status, 200);
  const store2b = r.cookie;
  assert.ok(store2b, 'current session cookie is re-issued');
  assert.equal((await call('GET', '/api/auth/me', { cookie: aliceWeb })).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { cookie: store2b })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { cookie: `token=${music3}` })).status, 200);
  ok('sign out everywhere else keeps this device (store + its apps)');

  // Legacy (pre-v2) token without sid still works until revoke-all
  const legacy = jwt.sign({ id: jwt.decode(store2b.slice(6)).id, username: 'alice', role: 'user' }, 'test-secret', {
    expiresIn: 3600,
  });
  r = await call('GET', '/api/auth/me', { cookie: `token=${legacy}` });
  assert.equal(r.status, 200);
  const oldLegacy = jwt.sign(
    { id: jwt.decode(store2b.slice(6)).id, username: 'alice', role: 'user', iat: Math.floor(Date.now() / 1000) - 600 },
    'test-secret',
    { expiresIn: 3600 }
  );
  r = await call('GET', '/api/auth/me', { cookie: `token=${oldLegacy}` });
  assert.equal(r.status, 401);
  ok('legacy tokens without sid still work, but sign-out-everywhere cuts off older ones');

  // Admin
  const adminRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': '10.0.0.3' },
    body: JSON.stringify({ username: 'admin', password: 'admin-password' }),
  });
  const adminCookie = cookieFrom(adminRes);
  r = await call('GET', '/api/auth/admin/users', { cookie: store2b });
  assert.equal(r.status, 403);
  r = await call('GET', '/api/auth/admin/users', { cookie: adminCookie });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json), 'plain array, as Quarc Music expects');
  const aliceRow = r.json.find((u) => u.username === 'alice');
  assert.ok(aliceRow && aliceRow.created_at && aliceRow.role === 'user');
  ok('admin endpoints are admin-only; user list keeps the shape Quarc Music reads');

  // Quarc Music's friends search
  r = await call('GET', '/api/auth/users/search?q=adm', { cookie: store2b });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((u) => u.username), ['admin']);
  assert.deepEqual(Object.keys(r.json[0]).sort(), ['id', 'username']);
  r = await call('GET', '/api/auth/users/search?q=ali', { cookie: store2b });
  assert.equal(r.json.length, 0, 'the caller is excluded');
  r = await call('GET', '/api/auth/users/search?q=%25', { cookie: adminCookie });
  assert.equal(r.json.length, 0, 'LIKE wildcards are escaped');
  assert.equal((await call('GET', '/api/auth/users/search?q=adm')).status, 401);
  ok('user search (Quarc Music friends): id + username only, needs login');

  r = await call('POST', '/api/auth/admin/users', { cookie: adminCookie, body: { username: 'bob', password: 'bobpassword' } });
  assert.equal(r.status, 201);
  const bobId = r.json.id;
  r = await call('PATCH', `/api/auth/admin/users/${bobId}`, { cookie: adminCookie, body: { role: 'admin' } });
  assert.equal(r.json.role, 'admin');
  const adminId = jwt.decode(adminCookie.slice(6)).id;
  r = await call('DELETE', `/api/auth/admin/users/${adminId}`, { cookie: adminCookie });
  assert.equal(r.status, 400);
  r = await call('PATCH', `/api/auth/admin/users/${bobId}`, { cookie: adminCookie, body: { role: 'user' } });
  r = await call('PATCH', `/api/auth/admin/users/${adminId}`, { cookie: adminCookie, body: { role: 'user' } });
  assert.equal(r.status, 400);
  ok("admin can manage users but can't remove the last admin or themselves");

  // Admin password reset signs the user out everywhere
  const aliceId = jwt.decode(store2b.slice(6)).id;
  r = await call('PATCH', `/api/auth/admin/users/${aliceId}`, { cookie: adminCookie, body: { password: 'newpassword1' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { cookie: store2b })).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { cookie: `token=${music3}` })).status, 401);
  ok('admin password reset signs that user out of every app');

  // Quarc Music's reset-password call
  const alice2 = await (async () => {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': '10.0.0.4' },
      body: JSON.stringify({ username: 'alice', password: 'newpassword1' }),
    });
    return cookieFrom(res);
  })();
  r = await call('POST', `/api/auth/admin/users/${aliceId}/reset-password`, { cookie: adminCookie, body: { newPassword: 'short' } });
  assert.equal(r.status, 400);
  r = await call('POST', `/api/auth/admin/users/${aliceId}/reset-password`, { cookie: adminCookie, body: { newPassword: 'thirdpassword' } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { cookie: alice2 })).status, 401);
  ok("Quarc Music's reset-password endpoint works and signs the user out");

  r = await call('DELETE', `/api/auth/admin/users/${bobId}`, { cookie: adminCookie });
  assert.equal(r.status, 200);
  ok('admin can delete users');
}
