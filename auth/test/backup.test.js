// Nightly backup module (identical copy in backend/src/lib).
// Run: npm test   (from Quarc_Store/auth)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { runOnce } = require('../src/lib/nightlyBackup');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-backup-test-'));
const dir = path.join(tmp, 'backups');
const db = new Database(path.join(tmp, 'auth.db'));
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE users (id TEXT); INSERT INTO users VALUES (1), (2), (3);');
const getDb = () => db;

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const at = (iso) => Date.parse(iso);

(async () => {
  // Before the backup hour, with no backup at all yet → back up right away.
  let written = await runOnce(getDb, 'auth.db', { dir, keepDays: 3, hourUtc: 2, now: at('2026-11-18T00:30:00Z') });
  assert.ok(written && written.endsWith(path.join('nightly_2026-11-18', 'auth.db')));
  const copy = new Database(written, { readonly: true });
  assert.equal(copy.prepare('SELECT COUNT(*) AS c FROM users').get().c, 3);
  copy.close();
  assert.ok(!fs.existsSync(`${written}.partial`));
  ok('first run backs up immediately; the copy is a complete, readable database');

  written = await runOnce(getDb, 'auth.db', { dir, keepDays: 3, hourUtc: 2, now: at('2026-11-18T05:00:00Z') });
  assert.equal(written, null);
  ok('only one backup per day');

  written = await runOnce(getDb, 'auth.db', { dir, keepDays: 3, hourUtc: 2, now: at('2026-11-19T01:00:00Z') });
  assert.equal(written, null);
  written = await runOnce(getDb, 'auth.db', { dir, keepDays: 3, hourUtc: 2, now: at('2026-11-19T02:10:00Z') });
  assert.ok(written && written.includes('nightly_2026-11-19'));
  ok('next day: waits for the backup hour, then backs up');

  // Server was off for days → backs up right away, whatever the hour.
  const dir2 = path.join(tmp, 'backups2');
  fs.mkdirSync(path.join(dir2, 'nightly_2026-11-15'), { recursive: true });
  fs.writeFileSync(path.join(dir2, 'nightly_2026-11-15', 'auth.db'), 'old');
  written = await runOnce(getDb, 'auth.db', { dir: dir2, keepDays: 14, hourUtc: 2, now: at('2026-11-19T00:10:00Z') });
  assert.ok(written && written.includes('nightly_2026-11-19'));
  ok('after missed nights it backs up immediately');

  // Old folders: one with only our file, one shared with the Store's store.db.
  for (const d of ['nightly_2026-11-01', 'nightly_2026-11-02']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, 'auth.db'), 'old');
  }
  fs.writeFileSync(path.join(dir, 'nightly_2026-11-02', 'store.db'), 'old');
  fs.mkdirSync(path.join(dir, 'unrelated'));
  await runOnce(getDb, 'auth.db', { dir, keepDays: 3, hourUtc: 2, now: at('2026-11-19T03:00:00Z') });
  assert.ok(!fs.existsSync(path.join(dir, 'nightly_2026-11-01')), 'old folder with only our file removed');
  assert.ok(!fs.existsSync(path.join(dir, 'nightly_2026-11-02', 'auth.db')), 'old auth.db removed');
  assert.ok(fs.existsSync(path.join(dir, 'nightly_2026-11-02', 'store.db')), "the other service's file is left alone");
  assert.ok(fs.existsSync(path.join(dir, 'nightly_2026-11-18', 'auth.db')), 'recent backups kept');
  assert.ok(fs.existsSync(path.join(dir, 'unrelated')), 'unrelated folders untouched');
  ok("prunes backups older than the limit without touching the other service's file");

  db.close();
  console.log('\nAll nightly backup tests passed.');
})().catch((err) => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
