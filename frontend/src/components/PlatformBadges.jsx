// Product names — the same in every language, so not translated.
const LABELS = { android: 'Android', windows: 'Windows', macos: 'macOS', linux: 'Linux', web: 'Web' };

export default function PlatformBadges({ platforms = [] }) {
  if (!platforms.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {platforms.map((p) => (
        <span key={p} className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          {LABELS[p] || p}
        </span>
      ))}
    </div>
  );
}
