import { useState } from 'react';

/** The app's icon if it has one, else a coloured tile with its initial. */
export default function AppIcon({ app, size = 56 }) {
  const [broken, setBroken] = useState(false);
  const radius = Math.round(size * 0.24);
  if (app.iconUrl && !broken) {
    return (
      <img
        src={app.iconUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 bg-zinc-800 object-cover"
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }
  const letter = (app.name || '?').replace(/^Quarc\s+/i, '').charAt(0).toUpperCase() || 'Q';
  return (
    <div
      aria-hidden
      className="flex shrink-0 select-none items-center justify-center font-bold text-white"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: size * 0.42,
        background: `linear-gradient(140deg, ${app.accent || '#6366f1'}, ${app.accent || '#6366f1'}99)`,
      }}
    >
      {letter}
    </div>
  );
}
