import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronRight, KeyRound } from 'lucide-react';
import useCatalogStore from '../store/catalogStore';
import useDeviceStore, { useUpdatable, isRequired } from '../store/deviceStore';
import useAuthStore from '../store/authStore';
import AppIcon from '../components/AppIcon';
import AppActionButton from '../components/AppActionButton';
import PlatformBadges from '../components/PlatformBadges';
import { isNative } from '../lib/native';

function AppRow({ app }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const info = useDeviceStore((s) => (app.packageName ? s.installed[app.packageName] : null));
  const open = () => navigate(`/app/${app.id}`);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
      className="flex cursor-pointer items-center gap-3.5 rounded-2xl p-2.5 transition-colors hover:bg-zinc-900"
    >
      <AppIcon app={app} size={56} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate font-semibold text-white">{app.name}</p>
          {app.sso && <KeyRound size={12} className="shrink-0 text-accent" aria-label={t('sso.badge', 'Uses your Quarc login')} />}
        </div>
        {isRequired(app, info) ? (
          <p className="truncate text-sm font-medium text-red-400">{t('required.short', 'Update required')}</p>
        ) : (
          <p className="truncate text-sm text-zinc-500">{app.tagline}</p>
        )}
        <div className="mt-1 flex items-center gap-2">
          {info?.installed ? (
            <span className="text-[11px] text-zinc-500">
              v{info.versionName}
              {app.latest && info.versionName !== app.latest.version ? ` → v${app.latest.version}` : ''}
            </span>
          ) : app.latest ? (
            <span className="text-[11px] text-zinc-500">v{app.latest.version}</span>
          ) : null}
          <PlatformBadges platforms={app.platforms} />
        </div>
      </div>
      <AppActionButton app={app} compact onNavigate={open} />
    </div>
  );
}

export default function Apps() {
  const { t } = useTranslation();
  const { apps, loading, error, loaded, load } = useCatalogStore();
  const installed = useDeviceStore((s) => s.installed);
  const refreshDevice = useDeviceStore((s) => s.refresh);
  const updates = useUpdatable(apps);
  const user = useAuthStore((s) => s.user);

  const native = isNative();
  const store = apps.find((a) => a.id === 'store');
  const others = apps.filter((a) => a.id !== 'store');
  const mine = native ? others.filter((a) => installed[a.packageName]?.installed) : [];
  const rest = native ? others.filter((a) => !installed[a.packageName]?.installed) : others;

  const reload = async () => {
    await load();
    refreshDevice();
  };

  return (
    <div className="space-y-6">
      {native && !user && (
        <Link to="/account" className="card flex items-center gap-3 border-accent/30 bg-accent-soft p-4">
          <KeyRound className="shrink-0 text-accent" size={22} />
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{t('home.ssoTitle', 'Sign in once, use every app')}</p>
            <p className="text-xs text-emerald-200/80">{t('home.ssoBody', 'Sign in to Quarc Store and all your Quarc apps on this phone are signed in too.')}</p>
          </div>
          <ChevronRight size={18} className="text-zinc-500" />
        </Link>
      )}

      {updates.length > 0 && (
        <Link to="/updates" className="card flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
            <RefreshCw size={18} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{t('home.updatesTitle', '{{count}} update(s) available', { count: updates.length })}</p>
            <p className="truncate text-xs text-zinc-500">{updates.map((a) => a.name).join(', ')}</p>
          </div>
          <ChevronRight size={18} className="text-zinc-500" />
        </Link>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">{t('home.title', 'Quarc apps')}</h1>
        <button onClick={reload} disabled={loading} className="btn-ghost px-2.5 py-1.5" aria-label={t('action.refresh', 'Refresh')}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && !apps.length && (
        <div className="card p-6 text-center text-sm text-zinc-400">
          <p>{t('home.loadError', "Couldn't load the app list.")}</p>
          <p className="mt-1 text-xs text-zinc-600">{error}</p>
          <button className="btn-secondary mt-3" onClick={reload}>{t('action.retry', 'Try again')}</button>
        </div>
      )}
      {!loaded && loading && <p className="py-10 text-center text-sm text-zinc-500">{t('home.loading', 'Loading apps…')}</p>}

      {mine.length > 0 && (
        <section>
          <h2 className="section-title">{t('home.installed', 'On this device')}</h2>
          <div className="-mx-2.5">{mine.map((a) => <AppRow key={a.id} app={a} />)}</div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="section-title">{native ? t('home.available', 'Available') : t('home.all', 'All apps')}</h2>
          <div className="-mx-2.5">{rest.map((a) => <AppRow key={a.id} app={a} />)}</div>
        </section>
      )}

      {store && (
        <section>
          <h2 className="section-title">{t('home.system', 'Quarc Store')}</h2>
          <div className="-mx-2.5"><AppRow app={store} /></div>
        </section>
      )}
    </div>
  );
}
