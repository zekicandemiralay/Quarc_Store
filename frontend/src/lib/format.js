/** Numeric version comparison: 1.0.10 > 1.0.9. A leading "v" and any suffix are ignored. */
export function compareVersions(a, b) {
  const parse = (v) =>
    String(v || '0')
      .replace(/^[vV]/, '')
      .split(/[.+-]/)
      .map((x) => parseInt(x, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(iso, lang) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

/** "3 min ago" style relative time for unix seconds or ISO strings. */
export function timeAgo(value, t) {
  if (!value) return '';
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return t('time.justNow', 'just now');
  const m = Math.round(s / 60);
  if (m < 60) return t('time.minutes', '{{count}} min ago', { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('time.hours', '{{count}} h ago', { count: h });
  const d = Math.round(h / 24);
  if (d < 30) return t('time.days', '{{count}} d ago', { count: d });
  return new Date(ms).toLocaleDateString();
}
