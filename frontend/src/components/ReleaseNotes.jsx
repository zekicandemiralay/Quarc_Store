import { openExternal } from '../lib/native';

// A deliberately small Markdown renderer for GitHub release notes. It builds
// React elements (never raw HTML), so a release body can't inject markup.
// Supports headings, bullet/numbered lists, pipe tables, **bold**, `code`
// and [links](https://...).

function inline(text, keyBase) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)]+))/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2]) out.push(<strong key={key} className="font-semibold text-zinc-200">{m[2]}</strong>);
    else if (m[3]) out.push(<code key={key} className="rounded bg-zinc-800 px-1 py-0.5 text-[0.85em] text-zinc-200">{m[3]}</code>);
    else {
      const href = m[5] || m[6];
      const label = m[4] || m[6];
      out.push(
        <a
          key={key}
          href={href}
          onClick={(e) => {
            e.preventDefault();
            openExternal(href);
          }}
          className="text-accent underline-offset-2 hover:underline"
        >
          {label}
        </a>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function ReleaseNotes({ text, className = '' }) {
  if (!text || !text.trim()) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let list = null;
  let table = null;

  const flush = () => {
    if (list) blocks.push(list);
    if (table) blocks.push(table);
    list = null;
    table = null;
  };

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const k = `l${idx}`;
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const row = line.trim().startsWith('|') ? line.trim() : null;

    if (row) {
      if (list) {
        blocks.push(list);
        list = null;
      }
      if (/^\|[\s:|-]+\|$/.test(row)) return; // separator row
      const cells = row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (!table) table = { type: 'table', key: k, rows: [] };
      table.rows.push(cells);
      return;
    }
    if (table) {
      blocks.push(table);
      table = null;
    }
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        if (list) blocks.push(list);
        list = { type, key: k, items: [] };
      }
      list.items.push((bullet || numbered)[1]);
      return;
    }
    flush();
    if (heading) blocks.push({ type: 'h', key: k, text: heading[2] });
    else if (line.trim()) blocks.push({ type: 'p', key: k, text: line.trim() });
  });
  flush();

  return (
    <div className={`space-y-2 text-sm leading-relaxed text-zinc-400 ${className}`}>
      {blocks.map((b) => {
        if (b.type === 'h') return <p key={b.key} className="pt-1 font-semibold text-zinc-200">{inline(b.text, b.key)}</p>;
        if (b.type === 'p') return <p key={b.key}>{inline(b.text, b.key)}</p>;
        if (b.type === 'ul' || b.type === 'ol') {
          const Tag = b.type;
          return (
            <Tag key={b.key} className={`space-y-1 pl-5 ${b.type === 'ul' ? 'list-disc' : 'list-decimal'}`}>
              {b.items.map((it, i) => (
                <li key={i}>{inline(it, `${b.key}-${i}`)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <div key={b.key} className="overflow-x-auto">
            <table className="text-xs">
              <tbody>
                {b.rows.map((cells, r) => (
                  <tr key={r} className={r === 0 ? 'font-semibold text-zinc-300' : ''}>
                    {cells.map((c, ci) => (
                      <td key={ci} className="border-b border-zinc-800 py-1 pr-4 align-top">
                        {inline(c, `${b.key}-${r}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
