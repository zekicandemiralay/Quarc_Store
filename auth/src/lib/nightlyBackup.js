// Nightly backup of this service's SQLite database.
//
// Identical copy in Quarc_Store/auth and Quarc_Store/backend: each service
// backs up its own database into the same dated folder,
//   BACKUP_DIR/nightly_YYYY-MM-DD/<file>
// which `bash restore.sh backups/nightly_YYYY-MM-DD` restores directly.
//
// Uses SQLite's online backup API through the service's own connection, so
// it's consistent even while the service is writing. Checked every 10
// minutes: once the UTC hour reaches BACKUP_HOUR_UTC (default 2) and today's
// backup doesn't exist yet — or immediately if there's no backup from today
// or yesterday (server was down at night, first start, ...). Keeps
// BACKUP_KEEP_DAYS days (default 14).

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const FOLDER_RE = /^nightly_(\d{4}-\d{2}-\d{2})$/;

const utcDate = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

function newestBackupMs(dir, fileName) {
  let newest = 0;
  for (const name of safeList(dir)) {
    const m = name.match(FOLDER_RE);
    if (!m || !fs.existsSync(path.join(dir, name, fileName))) continue;
    newest = Math.max(newest, Date.parse(m[1]));
  }
  return newest;
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function prune(dir, fileName, keepDays, now = Date.now()) {
  const cutoff = Date.parse(utcDate(now - keepDays * DAY_MS));
  for (const name of safeList(dir)) {
    const m = name.match(FOLDER_RE);
    if (!m || Date.parse(m[1]) >= cutoff) continue;
    const folder = path.join(dir, name);
    fs.rmSync(path.join(folder, fileName), { force: true });
    fs.rmSync(path.join(folder, `${fileName}.partial`), { force: true });
    // The other service's file may still be there; remove the folder only once empty.
    if (safeList(folder).length === 0) fs.rmSync(folder, { recursive: true, force: true });
  }
}

/** One check; resolves to the path written, or null if nothing was due. */
async function runOnce(getDb, fileName, { dir, keepDays, hourUtc, now = Date.now() }) {
  const target = path.join(dir, `nightly_${utcDate(now)}`, fileName);
  const hourReached = new Date(now).getUTCHours() >= hourUtc;
  // Missed a night (server was off) or never backed up: don't wait for the hour.
  const stale = newestBackupMs(dir, fileName) < Date.parse(utcDate(now - DAY_MS));
  let written = null;
  if (!fs.existsSync(target) && (hourReached || stale)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.partial`;
    await getDb().backup(tmp);
    fs.renameSync(tmp, target); // never leave a half-written file under the real name
    written = target;
  }
  prune(dir, fileName, keepDays, now);
  return written;
}

function startNightlyBackups(getDb, fileName) {
  const dir = process.env.BACKUP_DIR;
  if (!dir) return null;
  const opts = {
    dir,
    keepDays: Math.max(1, Number(process.env.BACKUP_KEEP_DAYS || 14)),
    hourUtc: Number(process.env.BACKUP_HOUR_UTC ?? 2),
  };
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const written = await runOnce(getDb, fileName, { ...opts, now: Date.now() });
      if (written) console.log(`[backup] wrote ${written}`);
    } catch (err) {
      console.error(`[backup] failed: ${err.message}`);
    } finally {
      busy = false;
    }
  };
  tick();
  const timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref();
  console.log(`Nightly backups of ${fileName} → ${dir} (after ${opts.hourUtc}:00 UTC, keeping ${opts.keepDays} days).`);
  return timer;
}

module.exports = { startNightlyBackups, runOnce };
