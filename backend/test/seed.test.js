// Catalog seeding on a server that was set up before an app joined the list.
// Run: npm test   (from Quarc_Store/backend)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-store-seed-'));
process.env.DB_PATH = path.join(tmp, 'store.db');

const { getDb, initDb, getMeta, setMeta } = require('../src/db');
const { seed, DEFAULT_APPS } = require('../src/seed');

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const ids = () => getDb().prepare('SELECT id FROM apps ORDER BY id').all().map((r) => r.id);

try {
  initDb();
  const db = getDb();
  // A server seeded by the old seed(): the first six apps and only the 'seeded' flag.
  const insert = db.prepare(
    'INSERT INTO apps (id, name, repo, package_name, sort_order) VALUES (@id, @name, @repo, @package_name, @sort_order)'
  );
  for (const app of DEFAULT_APPS.filter((a) => a.id !== 'sport')) insert.run(app);
  setMeta('seeded', '2026-11-18T00:00:00Z');
  // ...where the admin had since deleted Translate.
  db.prepare("DELETE FROM apps WHERE id = 'translate'").run();

  seed();
  assert.ok(ids().includes('sport'), 'Quarc Sport added to the existing catalog');
  assert.ok(!ids().includes('translate'), 'an app the admin deleted stays deleted');
  const sport = db.prepare("SELECT * FROM apps WHERE id = 'sport'").get();
  assert.equal(sport.package_name, 'com.quarc.sport');
  assert.equal(sport.sso, 1);
  assert.match(sport.web_url, /:4007$/);
  ok('a server seeded before Quarc Sport existed gets it on the next start; deleted apps stay deleted');

  db.prepare("DELETE FROM apps WHERE id = 'sport'").run();
  seed();
  assert.ok(!ids().includes('sport'));
  ok('once seeded, deleting Quarc Sport in Admin is final');

  // The admin added it by hand under another id before upgrading: no duplicate.
  setMeta('seeded_ids', JSON.stringify(['music', 'notes', 'calendar', 'weather', 'translate', 'store']));
  insert.run({ id: 'garmin', name: 'Sport (manual)', repo: null, package_name: 'com.quarc.sport', sort_order: 99 });
  seed();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM apps WHERE package_name = 'com.quarc.sport'").get().n, 1);
  assert.ok(JSON.parse(getMeta('seeded_ids')).includes('sport'));
  ok('an app the admin already added by hand (same package) is not duplicated');

  // Sport listed with the text 1.0 seeded: it gets today's text; an admin's own text stays.
  const sportDefault = DEFAULT_APPS.find((a) => a.id === 'sport');
  db.prepare("DELETE FROM apps WHERE id = 'garmin'").run();
  insert.run({ ...sportDefault, sort_order: 60 });
  db.prepare("UPDATE apps SET tagline = 'Your Garmin activities and health', description = ? WHERE id = 'sport'").run(
    'Runs, rides and walks on a map, personal bests and training load, plus heart rate, sleep, steps and body battery, synced from Garmin Connect.'
  );
  seed();
  let texts = db.prepare("SELECT tagline, description FROM apps WHERE id = 'sport'").get();
  assert.equal(texts.tagline, sportDefault.tagline);
  assert.equal(texts.description, sportDefault.description);
  db.prepare("UPDATE apps SET tagline = 'Written by the admin' WHERE id = 'sport'").run();
  seed();
  texts = db.prepare("SELECT tagline FROM apps WHERE id = 'sport'").get();
  assert.equal(texts.tagline, 'Written by the admin');
  ok("an untouched old default text is refreshed on start; the admin's own text is kept");

  console.log('\nAll seed tests passed.');
  process.exit(0);
} catch (err) {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
}
