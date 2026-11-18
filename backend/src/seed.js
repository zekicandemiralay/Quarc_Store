// The catalog Quarc Store starts with. Inserted once, on first start; after
// that the admin edits it in the Store (Admin → Catalog) and this file is
// never consulted again — deleting an app there won't bring it back.
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

function seed() {
  if (getMeta('seeded')) return;
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO apps (id, name, tagline, description, repo, package_name, web_url, icon_url, accent, sso, sort_order)
    VALUES (@id, @name, @tagline, @description, @repo, @package_name, @web_url, @icon_url, @accent, @sso, @sort_order)
  `);
  db.transaction(() => {
    for (const app of DEFAULT_APPS) insert.run({ sso: 1, ...app });
  })();
  setMeta('seeded', new Date().toISOString());
  console.log(`Seeded catalog with ${DEFAULT_APPS.length} apps.`);
}

module.exports = { seed, isBlocked, DEFAULT_APPS };
