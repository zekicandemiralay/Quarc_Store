// The catalog Quarc Store starts with. Each entry is inserted once — on first
// start, or on the first start after it was added to this list (so a new app
// reaches existing servers too). After that the admin edits it in the Store
// (Admin → Catalog); deleting an app there won't bring it back.
//
// The Store lists Android apps only (every entry needs a package name).

const { getDb, getMeta, setMeta } = require('./db');

const HOST = process.env.PUBLIC_HOST || 'https://quarcnet0.tail84500c.ts.net';
const OWNER = process.env.GITHUB_OWNER || 'zekicandemiralay';

const DEFAULT_APPS = [
  {
    id: 'music',
    name: 'Quarc Music',
    tagline: 'Your music library, everywhere',
    description:
      'Stream your own library, download from YouTube, build playlists, listen offline, and see your listening stats. Background playback with lock-screen controls.',
    repo: `${OWNER}/Quarc_Music`,
    package_name: 'com.quarc.music',
    web_url: `${HOST}:4000`,
    icon_url: `${HOST}:4000/logo.png`,
    accent: '#1db954',
    sort_order: 10,
  },
  {
    id: 'notes',
    name: 'Quarc Notes',
    tagline: 'Notes, wikilinks and handwriting',
    description:
      'Nested pages with a block editor, [[wikilinks]] and backlinks, full-text search, and pressure-sensitive handwriting pages for stylus input. Works offline.',
    repo: `${OWNER}/Quarc_Notes`,
    package_name: 'com.quarc.notes',
    web_url: `${HOST}:4001`,
    icon_url: `${HOST}:4001/logo.png`,
    accent: '#a78bfa',
    sort_order: 20,
  },
  {
    id: 'calendar',
    name: 'Quarc Calendar',
    tagline: 'Your schedule, synced',
    description: 'Calendars, recurring events and reminders that sync across your devices and work offline.',
    repo: `${OWNER}/Quarc_Calendar`,
    package_name: 'com.quarc.calendar',
    web_url: `${HOST}:4005`,
    icon_url: `${HOST}:4005/logo.png`,
    accent: '#e5484d',
    sort_order: 30,
  },
  {
    id: 'weather',
    name: 'Quarc Weather',
    tagline: 'Forecasts, radar and a home-screen widget',
    description: 'Current conditions, hourly and daily forecasts, rain radar, a daily briefing and a native home-screen widget.',
    repo: `${OWNER}/Quarc_Weather`,
    package_name: 'com.quarc.weather',
    web_url: `${HOST}:4002`,
    icon_url: `${HOST}:4002/logo.png`,
    accent: '#38bdf8',
    sort_order: 40,
  },
  {
    id: 'translate',
    name: 'Quarc Translate',
    tagline: 'Private, self-hosted translation',
    description: 'Translate text between languages on your own server — nothing leaves your network.',
    repo: `${OWNER}/Quarc_Translate`,
    package_name: 'com.quarc.translate',
    web_url: `${HOST}:4003`,
    icon_url: `${HOST}:4003/logo.png`,
    accent: '#f59e0b',
    sort_order: 50,
  },
  {
    id: 'sport',
    name: 'Quarc Sport',
    tagline: 'Your sport and health data, in one place',
    description:
      'Runs, rides and walks on a map, personal bests and training load, plus heart rate, sleep and steps, from Garmin Connect, Strava or your phone\'s Health Connect.',
    repo: `${OWNER}/Quarc_Sport`,
    package_name: 'com.quarc.sport',
    web_url: `${HOST}:4007`,
    icon_url: `${HOST}:4007/logo.png`,
    accent: '#84cc16',
    sort_order: 60,
  },
  {
    id: 'reader',
    name: 'Quarc Reader',
    tagline: 'Read, highlight and annotate PDFs',
    description:
      'Your PDF library on every device: highlight text, write and draw with a pen, add notes and note pages, then export an annotated copy or share a read-only link. Each document can stay on this device or sync.',
    repo: `${OWNER}/Quarc_Reader`,
    package_name: 'com.quarc.reader',
    web_url: `${HOST}:4008`,
    icon_url: `${HOST}:4008/logo.png`,
    accent: '#9b51f2',
    sort_order: 70,
  },
  {
    id: 'draw',
    name: 'Quarc Draw',
    tagline: 'Draw, paint and sketch',
    description:
      'A layered drawing studio: pressure-sensitive brushes, vector shapes, filters, notebooks and PDF markup. Everything works offline; sign in to sync your drawings on every device.',
    repo: `${OWNER}/Quarc_Draw`,
    package_name: 'com.quarc.draw',
    web_url: `${HOST}:4009`,
    icon_url: `${HOST}:4009/logo.png`,
    accent: '#14b8a6',
    sort_order: 80,
  },
  {
    id: 'store',
    name: 'Quarc Store',
    tagline: 'Every Quarc app, one login',
    description: 'Install and update every Quarc app, and sign in to all of them at once on this device.',
    repo: `${OWNER}/Quarc_Store`,
    package_name: 'com.quarc.store',
    web_url: `${HOST}:4006`,
    icon_url: `${HOST}:4006/logo.png`,
    accent: '#10b981',
    // The Store is the one handing out logins, it never receives one.
    sso: 0,
    sort_order: 1000,
  },
];

// Quarc Cleaning is a separate, at-home app with nothing to do with the rest
// of Quarc; it must never be listed. Enforced on admin edits too.
function isBlocked({ id, repo, package_name, name } = {}) {
  return [id, repo, package_name, name].some((v) => typeof v === 'string' && /cleaning/i.test(v));
}

// What servers seeded before the per-app record ('seeded_ids') existed.
const FIRST_SEED = ['music', 'notes', 'calendar', 'weather', 'translate', 'store'];

// Default texts this file used to seed. When a listed app still carries one of
// them word for word, nobody edited it in Admin, so it gets today's default text
// on the next start. Anything the admin wrote is left alone.
const PREVIOUS_TEXTS = {
  sport: {
    tagline: ['Your Garmin activities and health'],
    description: [
      'Runs, rides and walks on a map, personal bests and training load, plus heart rate, sleep, steps and body battery, synced from Garmin Connect.',
    ],
  },
};

function refreshDefaultTexts() {
  const db = getDb();
  let changed = 0;
  for (const [id, fields] of Object.entries(PREVIOUS_TEXTS)) {
    const app = DEFAULT_APPS.find((a) => a.id === id);
    if (!app) continue;
    for (const [field, old] of Object.entries(fields)) {
      if (!['tagline', 'description'].includes(field) || !old.length) continue;
      const marks = old.map(() => '?').join(', ');
      changed += db
        .prepare(`UPDATE apps SET ${field} = ?, updated_at = datetime('now') WHERE id = ? AND ${field} IN (${marks})`)
        .run(app[field], id, ...old).changes;
    }
  }
  if (changed) console.log(`Catalog: refreshed ${changed} default text(s).`);
}

function seed() {
  refreshDefaultTexts();
  const db = getDb();
  // Ids ever seeded here, so an app the admin deleted is never re-added.
  const stored = getMeta('seeded_ids');
  const done = new Set(stored ? JSON.parse(stored) : getMeta('seeded') ? FIRST_SEED : []);
  const fresh = DEFAULT_APPS.filter((app) => !done.has(app.id));
  if (!fresh.length) return;
  // An app the admin already added by hand (same id or package name) wins.
  const insert = db.prepare(`
    INSERT OR IGNORE INTO apps (id, name, tagline, description, repo, package_name, web_url, icon_url, accent, sso, sort_order)
    VALUES (@id, @name, @tagline, @description, @repo, @package_name, @web_url, @icon_url, @accent, @sso, @sort_order)
  `);
  const listed = db.prepare('SELECT 1 FROM apps WHERE package_name = ?');
  db.transaction(() => {
    for (const app of fresh) if (!listed.get(app.package_name)) insert.run({ sso: 1, ...app });
    for (const app of fresh) done.add(app.id);
    setMeta('seeded_ids', JSON.stringify([...done]));
    if (!getMeta('seeded')) setMeta('seeded', new Date().toISOString());
  })();
  console.log(`Catalog: added ${fresh.map((a) => a.name).join(', ')}.`);
}

module.exports = { seed, isBlocked, DEFAULT_APPS };
