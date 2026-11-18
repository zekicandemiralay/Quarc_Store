// Regenerates src/i18n/en.json from every t('key', 'English default') call in
// src/, then lists keys missing from tr.json. English lives next to the code
// that uses it; this keeps the JSON file honest.
//
// Run: npm run i18n:check

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const re = /\bt\(\s*'([\w.]+)'\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(jsx?|tsx?)$/.test(e.name) ? [p] : [];
  });
}

const flat = {};
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(re)) {
    const value = (m[2] ?? m[3]).replace(/\\(['"\\])/g, '$1');
    if (flat[m[1]] && flat[m[1]] !== value) console.warn(`! "${m[1]}" has two different defaults`);
    flat[m[1]] = value;
  }
}

function nest(obj) {
  const out = {};
  for (const key of Object.keys(obj).sort()) {
    const parts = key.split('.');
    let cur = out;
    parts.slice(0, -1).forEach((p) => (cur = cur[p] ??= {}));
    cur[parts.at(-1)] = obj[key];
  }
  return out;
}
function flatten(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

fs.writeFileSync(path.join(root, 'i18n', 'en.json'), JSON.stringify(nest(flat), null, 2) + '\n');
console.log(`en.json: ${Object.keys(flat).length} keys`);

const trPath = path.join(root, 'i18n', 'tr.json');
const tr = fs.existsSync(trPath) ? JSON.parse(fs.readFileSync(trPath, 'utf8')) : {};
const trKeys = new Set(flatten(tr));
const missing = Object.keys(flat).filter((k) => !trKeys.has(k));
const extra = [...trKeys].filter((k) => !(k in flat));
if (missing.length) console.log(`tr.json missing ${missing.length}:\n  ${missing.join('\n  ')}`);
if (extra.length) console.log(`tr.json has ${extra.length} unused:\n  ${extra.join('\n  ')}`);
if (!missing.length && !extra.length) console.log('tr.json is complete.');
process.exitCode = missing.length ? 1 : 0;
