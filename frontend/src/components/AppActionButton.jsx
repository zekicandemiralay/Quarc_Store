import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, ExternalLink, Play, X } from 'lucide-react';
import useDeviceStore, { useAppStatus } from '../store/deviceStore';
import { isNative, openExternal } from '../lib/native';
import { toast } from '../store/toastStore';

/** The one primary action for an app: Install / Update / Open / progress. */
export default function AppActionButton({ app, compact = false, onNavigate }) {
  const { t } = useTranslation();
  const { status, task } = useAppStatus(app);
  const install = useDeviceStore((s) => s.install);
  const launch = useDeviceStore((s) => s.launch);
  const cancel = useDeviceStore((s) => s.cancel);
  const size = compact ? 'px-3.5 py-1.5 text-xs' : '';

  async function run() {
    const r = await install(app);
    if (r.phase === 'failed') toast(t('install.failed', 'Install failed: {{msg}}', { msg: r.message || '' }), { tone: 'error', ms: 6000 });
    else if (r.phase === 'done') toast(t('install.done', '{{name}} is ready', { name: app.name }), { tone: 'success' });
  }

  if (!isNative()) {
    if (app.webUrl) {
      return (
        <button className={`btn-primary ${size}`} onClick={(e) => { e.stopPropagation(); openExternal(app.webUrl); }}>
          <ExternalLink size={14} /> {t('action.open', 'Open')}
        </button>
      );
    }
    return (
      <button className={`btn-secondary ${size}`} onClick={(e) => { e.stopPropagation(); onNavigate?.(); }}>
        <Download size={14} /> {t('action.get', 'Get')}
      </button>
    );
  }

  if (status === 'busy') {
    const pct = Math.round(task?.progress || 0);
    const label =
      task?.phase === 'downloading'
        ? `${pct}%`
        : task?.phase === 'confirm'
          ? t('install.confirm', 'Confirm…')
          : task?.phase === 'installing'
            ? t('install.installing', 'Installing…')
            : t('install.queued', 'Waiting…');
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <div className={`relative overflow-hidden rounded-full bg-zinc-800 ${compact ? 'h-7 w-20' : 'h-9 w-28'}`}>
          <div
            className="absolute inset-y-0 left-0 bg-accent/60 transition-[width]"
            style={{ width: task?.phase === 'downloading' ? `${pct}%` : '100%' }}
          />
          <span className="relative flex h-full items-center justify-center text-xs font-semibold">{label}</span>
        </div>
        {task?.phase === 'downloading' && (
          <button className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-white" onClick={() => cancel(app.packageName)} aria-label={t('action.cancel', 'Cancel')}>
            <X size={14} />
          </button>
        )}
      </div>
    );
  }

  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };

  switch (status) {
    case 'install':
      return (
        <button className={`btn-primary ${size}`} onClick={stop(run)}>
          <Download size={14} /> {t('action.install', 'Install')}
        </button>
      );
    case 'update':
      return (
        <button className={`btn-primary ${size}`} onClick={stop(run)}>
          <RefreshCw size={14} /> {t('action.update', 'Update')}
        </button>
      );
    case 'open':
      if (app.packageName === 'com.quarc.store') {
        // That's us — nothing to open.
        return <span className={`px-3 text-xs font-medium text-zinc-500 ${compact ? '' : 'py-2'}`}>{t('action.installed', 'Installed')}</span>;
      }
      return (
        <button
          className={`btn-secondary ${size}`}
          onClick={stop(() => launch(app)?.catch(() => toast(t('action.cantOpen', "Couldn't open the app"), { tone: 'error' })))}
        >
          <Play size={14} /> {t('action.open', 'Open')}
        </button>
      );
    case 'web':
      return (
        <button className={`btn-secondary ${size}`} onClick={stop(() => openExternal(app.webUrl))}>
          <ExternalLink size={14} /> {t('action.openWeb', 'Open web')}
        </button>
      );
    default:
      return (
        <button className={`btn-ghost ${size}`} onClick={stop(() => onNavigate?.())}>
          {t('action.details', 'Details')}
        </button>
      );
  }
}
