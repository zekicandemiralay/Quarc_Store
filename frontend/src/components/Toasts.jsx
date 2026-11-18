import useToastStore from '../store/toastStore';

const TONES = {
  info: 'bg-zinc-800 text-zinc-100',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

export default function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm shadow-lg animate-pop ${TONES[t.tone] || TONES.info}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
