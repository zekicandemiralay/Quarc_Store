// Serves ci/harness.html to the Mac Store app under test and collects what it reports (ci/run-harness.sh).
//   GET  /harness.html, /params   the page and what it should install (from the environment)
//   GET  /running?bundle=...      which processes run from that .app (the page can't see that itself)
//   POST /log, /result            progress lines and the final results; /result also writes RESULT_FILE
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8765);
const params = {
  dmg: process.env.NOTES_DMG_URL,
  version: process.env.NOTES_VERSION,
  notesPath: process.env.NOTES_PATH || '/Applications/Quarc Notes.app',
  arch: process.env.EXPECT_ARCH || 'arm64',
  storeVersion: process.env.STORE_VERSION,
};

function running(bundle) {
  const ps = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8' });
  const prefix = `${bundle.replace(/\/$/, '')}/Contents/MacOS/`;
  return ps
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
    .filter((m) => m && m[2].startsWith(prefix))
    .map((m) => Number(m[1]));
}

const body = (req) =>
  new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => (s += d)).on('end', () => resolve(s));
  });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (req.method === 'GET' && url.pathname === '/harness.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(readFileSync(join(here, 'harness.html')));
  }
  if (req.method === 'GET' && url.pathname === '/params') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(params));
  }
  if (req.method === 'GET' && url.pathname === '/running') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ pids: running(url.searchParams.get('bundle') || '') }));
  }
  if (req.method === 'POST' && url.pathname === '/log') {
    console.log('  page: ' + (await body(req)));
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'POST' && url.pathname === '/result') {
    writeFileSync(process.env.RESULT_FILE || join(here, 'result.json'), await body(req));
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(404);
  res.end();
}).listen(port, () => console.log(`harness server on http://localhost:${port}`));
