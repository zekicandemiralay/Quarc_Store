// Store backend test. Needs internet: it syncs real GitHub releases and
// extracts the real signing certificate from a published APK.
// Run: npm test   (from Quarc_Store/backend)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-store-test-'));
process.env.DB_PATH = path.join(tmp, 'store.db');
process.env.DISABLE_SYNC = 'true';

// Stub quarc-auth: "Cookie: token=admin" is an admin, "token=user" is not.
const authStub = http.createServer((req, res) => {
  const cookie = req.headers.cookie || '';
  res.setHeader('Content-Type', 'application/json');
  if (cookie.includes('token=admin')) return res.end(JSON.stringify({ id: '1', username: 'admin', role: 'admin' }));
  if (cookie.includes('token=user')) return res.end(JSON.stringify({ id: '2', username: 'u', role: 'user' }));
  res.statusCode = 401;
  res.end('{"error":"Not authenticated"}');
});

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);

authStub.listen(0, async () => {
  process.env.AUTH_URL = `http://127.0.0.1:${authStub.address().port}`;
  const app = require('../src/index');
  const { syncApp, computeMissingCerts } = require('../src/services/github');
  const server = app.listen(0, async () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (u, cookie) => fetch(base + u, { headers: cookie ? { Cookie: cookie } : {} }).then(async (r) => ({ status: r.status, json: await r.json() }));
    const send = (method, u, body, cookie) =>
      fetch(base + u, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, json: await r.json() }));
    try {
      let r = await get('/api/store/catalog');
      assert.equal(r.status, 200);
      const ids = r.json.apps.map((a) => a.id);
      assert.deepEqual([...ids].sort(), ['calendar', 'music', 'notes', 'reader', 'sport', 'store', 'translate', 'weather']);
      assert.ok(r.json.apps.every((a) => a.packageName), 'every listed app is an Android app');
      ok(`seeded catalog (Android apps only): ${ids.join(', ')}`);

      // Opening the catalog asks GitHub itself when the last check is stale —
      // the very first request had never synced, so it must carry releases.
      assert.ok(r.json.apps.find((a) => a.id === 'music').latest, 'first catalog request fetched releases from GitHub');
      const t0 = Date.now();
      await get('/api/store/catalog');
      assert.ok(Date.now() - t0 < 1500, 'a second request within 2 minutes does not re-check GitHub');
      ok('opening the Store / "Check now" fetches new releases on demand (throttled to once per 2 min)');

      // Real GitHub sync for Quarc Music
      await syncApp({ id: 'music', repo: 'zekicandemiralay/Quarc_Music' });
      r = await get('/api/store/apps/music');
      assert.equal(r.status, 200);
      assert.ok(r.json.latest, 'has a latest release');
      assert.ok(r.json.latest.assets.android, 'latest release has an APK');
      ok(`synced Quarc Music from GitHub: latest v${r.json.latest.version}, ${r.json.releases.length} releases`);

      await computeMissingCerts();
      r = await get('/api/store/apps/music');
      assert.equal(r.json.certSha256.length, 1, 'fingerprint computed');
      assert.match(r.json.certSha256[0], /^[0-9a-f]{64}$/);
      ok(`computed Quarc Music's signing fingerprint from its APK: ${r.json.certSha256[0].slice(0, 16)}…`);

      // A brand-new release shows up before its APK's fingerprint is computed:
      // the app must keep its known fingerprint meanwhile (else SSO breaks).
      const known = r.json.certSha256[0];
      const { getDb } = require('../src/db');
      getDb()
        .prepare('INSERT INTO releases (app_id, tag, version, name, body, published_at, html_url, assets_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('music', 'v9.9.9', '9.9.9', 'v9.9.9', '', new Date().toISOString(), 'https://example.com', JSON.stringify([{ name: 'x.apk', url: 'https://example.com/new.apk', size: 1, platform: 'android' }]));
      r = await get('/api/store/apps/music');
      assert.equal(r.json.latest.version, '9.9.9');
      assert.deepEqual(r.json.certSha256, [known]);
      getDb().prepare("DELETE FROM releases WHERE app_id = 'music' AND tag = 'v9.9.9'").run();
      ok("a new release doesn't drop the app's trusted fingerprint while its own is being computed");

      // Admin
      r = await send('POST', '/api/store/admin/apps', { id: 'x', name: 'X' });
      assert.equal(r.status, 401);
      r = await send('POST', '/api/store/admin/apps', { id: 'x', name: 'X' }, 'token=user');
      assert.equal(r.status, 403);
      ok('admin endpoints require an admin');

      r = await send('POST', '/api/store/admin/apps', { id: 'cleaning', name: 'Quarc Cleaning', repo: 'zekicandemiralay/Quarc_Cleaning' }, 'token=admin');
      assert.equal(r.status, 400);
      r = await send('PATCH', '/api/store/admin/apps/music', { repo: 'zekicandemiralay/Quarc_Cleaning' }, 'token=admin');
      assert.equal(r.status, 400);
      ok('Quarc Cleaning can never be added to the Store');

      r = await send('PATCH', '/api/store/admin/apps/music', { cert_sha256: 'AA:BB' }, 'token=admin');
      assert.equal(r.status, 400);
      const debugFp = 'ab'.repeat(32);
      r = await send('PATCH', '/api/store/admin/apps/music', { cert_sha256: debugFp.toUpperCase(), hidden: true }, 'token=admin');
      assert.equal(r.status, 200);
      assert.equal(r.json.certSha256.length, 2);
      assert.ok(r.json.certSha256.includes(debugFp));
      r = await get('/api/store/catalog');
      assert.ok(!r.json.apps.find((a) => a.id === 'music'), 'hidden apps are not in the public catalog');
      ok('extra fingerprints are validated/normalised; hidden apps leave the public catalog');

      r = await send('POST', '/api/store/admin/apps', { id: 'demo', name: 'Demo', package_name: 'com.quarc.music' }, 'token=admin');
      assert.equal(r.status, 409);
      ok('package names must be unique');

      r = await send('POST', '/api/store/admin/apps', { id: 'webonly', name: 'Web only', web_url: 'https://example.com' }, 'token=admin');
      assert.equal(r.status, 400);
      r = await send('PATCH', '/api/store/admin/apps/notes', { package_name: null }, 'token=admin');
      assert.equal(r.status, 400);
      ok('apps without an Android package name are refused (Android-only Store)');

      // Required updates (minimum version)
      r = await send('PATCH', '/api/store/admin/apps/music', { hidden: false, min_version: 'banana' }, 'token=admin');
      assert.equal(r.status, 400);
      r = await send('PATCH', '/api/store/admin/apps/music', { min_version: '99.0.0' }, 'token=admin');
      assert.equal(r.status, 400, 'newer than any release would lock everyone out');
      r = await send('PATCH', '/api/store/admin/apps/music', { hidden: false, min_version: 'v1.0.10' }, 'token=admin');
      assert.equal(r.status, 200);
      assert.equal(r.json.minVersion, '1.0.10');
      r = await get('/api/store/packages/com.quarc.music');
      assert.equal(r.status, 200);
      assert.equal(r.json.minVersion, '1.0.10');
      assert.match(r.json.latest.apkUrl, /\.apk$/);
      assert.match(r.json.latest.htmlUrl, /github\.com/);
      assert.equal((await get('/api/store/packages/com.example.nope')).status, 404);
      r = await send('PATCH', '/api/store/admin/apps/music', { min_version: '' }, 'token=admin');
      assert.equal(r.json.minVersion, null);
      ok('minimum version: validated, published per package for the apps, clearable');

      console.log('\nAll store backend tests passed.');
      process.exit(0);
    } catch (err) {
      console.error('\nTEST FAILED:', err);
      process.exit(1);
    }
  });
});
