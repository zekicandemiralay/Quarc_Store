// "Sign in with your phone" end to end, against a throwaway database.
// Run: npm test   (from Quarc_Store/auth)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-approval-test-'));
process.env.DB_PATH = path.join(tmp, 'auth.db');
process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin-password';
process.env.SECURE_COOKIE = 'false';

const app = require('../src/index');
const { getDb } = require('../src/db');

let base;
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);

function cookieFrom(res) {
  const tok = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith('token='));
  return tok ? tok.split(';')[0] : null;
}

async function call(method, url, { cookie, body, ip = '10.1.0.1', origin } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Real-IP': ip };
  if (cookie) headers.Cookie = cookie;
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

async function run() {
  await call('POST', '/api/auth/register', { body: { username: 'alice', password: 'password1' } });
  await call('POST', '/api/auth/register', { body: { username: 'bob', password: 'password1' } });
  const aliceWeb = (await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'password1' } })).cookie;
  const aliceStore = (await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'password1', client: 'quarc-store' } })).cookie;
  const bobStore = (await call('POST', '/api/auth/login', { body: { username: 'bob', password: 'password1', client: 'quarc-store' } })).cookie;

  let r = await call('POST', '/api/auth/approval/start', { body: { username: 'nobody' } });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json).sort(), ['expiresAt', 'id', 'number', 'secret']);
  ok("start looks the same for a username that doesn't exist (no account probing)");

  const req1 = (await call('POST', '/api/auth/approval/start', { body: { username: 'alice' }, origin: 'https://host:4001' })).json;
  assert.ok(req1.number >= 10 && req1.number <= 99);
  assert.equal((await call('POST', '/api/auth/approval/poll', { body: { id: req1.id, secret: req1.secret } })).json.status, 'pending');
  assert.equal((await call('POST', '/api/auth/approval/poll', { body: { id: req1.id, secret: 'x'.repeat(64) } })).status, 404);
  ok('the computer polls with its secret; a wrong secret gets nothing');

  assert.equal((await call('GET', '/api/auth/approval/pending', { cookie: aliceWeb })).status, 403);
  // The Windows Store may sign other apps in (sso/token) but must not approve a computer's sign-in.
  const aliceWindows = (await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'password1', client: 'quarc-store-windows' } })).cookie;
  assert.equal((await call('GET', '/api/auth/approval/pending', { cookie: aliceWindows })).status, 403);
  assert.deepEqual((await call('GET', '/api/auth/approval/pending', { cookie: bobStore })).json, []);
  r = await call('GET', '/api/auth/approval/pending', { cookie: aliceStore });
  assert.equal(r.json.length, 1);
  assert.equal(r.json[0].id, req1.id);
  assert.equal(r.json[0].client, 'Quarc Notes');
  assert.ok(!('number' in r.json[0]) && !('secret' in r.json[0]), 'the phone never receives the number');
  ok("only the account's own Quarc Store sees the request — without the number");

  r = await call('POST', `/api/auth/approval/${req1.id}/approve`, { cookie: aliceStore, body: { number: req1.number === 10 ? 11 : 10 } });
  assert.equal(r.status, 400);
  assert.equal((await call('POST', '/api/auth/approval/poll', { body: { id: req1.id, secret: req1.secret } })).json.status, 'denied');
  assert.equal((await call('POST', `/api/auth/approval/${req1.id}/approve`, { cookie: aliceStore, body: { number: req1.number } })).status, 410);
  ok('one wrong number blocks the request for good');

  const req2 = (await call('POST', '/api/auth/approval/start', { body: { username: 'alice' }, origin: 'https://host:4000' })).json;
  assert.equal((await call('POST', `/api/auth/approval/${req2.id}/approve`, { cookie: bobStore, body: { number: req2.number } })).status, 404);
  assert.equal((await call('POST', `/api/auth/approval/${req2.id}/approve`, { cookie: aliceWeb, body: { number: req2.number } })).status, 403);
  r = await call('POST', `/api/auth/approval/${req2.id}/approve`, { cookie: aliceStore, body: { number: req2.number } });
  assert.equal(r.status, 200);
  ok("another account's phone, or a non-Store session, can't approve");

  r = await call('POST', '/api/auth/approval/poll', { body: { id: req2.id, secret: req2.secret }, origin: 'https://host:4000' });
  assert.equal(r.json.status, 'approved');
  assert.equal(r.json.user.username, 'alice');
  assert.ok(r.cookie, 'login cookie set on the computer');
  const me = await call('GET', '/api/auth/me', { cookie: r.cookie });
  assert.equal(me.json.username, 'alice');
  const sessions = (await call('GET', '/api/auth/sessions', { cookie: r.cookie })).json.sessions;
  assert.ok(sessions.find((s) => s.current && s.client === 'Quarc Music'));
  assert.equal((await call('POST', '/api/auth/approval/poll', { body: { id: req2.id, secret: req2.secret } })).json.status, 'expired');
  ok('approved: the computer is signed in once (its own session), and the request is used up');

  const req3 = (await call('POST', '/api/auth/approval/start', { body: { username: 'alice' } })).json;
  getDb().prepare('UPDATE login_requests SET expires_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, req3.id);
  assert.equal((await call('POST', '/api/auth/approval/poll', { body: { id: req3.id, secret: req3.secret } })).json.status, 'expired');
  assert.equal((await call('POST', `/api/auth/approval/${req3.id}/approve`, { cookie: aliceStore, body: { number: req3.number } })).status, 410);
  assert.deepEqual((await call('GET', '/api/auth/approval/pending', { cookie: aliceStore })).json, []);
  ok('requests expire after 2 minutes');

  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', '/api/auth/approval/start', { body: { username: 'bob' }, ip: '10.9.9.9' });
  assert.equal(last.status, 429);
  ok('starting requests is rate limited per IP');
}

const server = app.listen(0, () => {
  base = `http://127.0.0.1:${server.address().port}`;
  run()
    .then(() => {
      console.log('\nAll phone sign-in tests passed.');
      server.close();
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nTEST FAILED:', err);
      server.close();
      process.exit(1);
    });
});
