import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, CheckCircle2, ChevronDown } from 'lucide-react';
import useCatalogStore from '../store/catalogStore';
import useDeviceStore, { useUpdatable, isRequired } from '../store/deviceStore';
import AppIcon from '../components/AppIcon';
import AppActionButton from '../components/AppActionButton';
import ReleaseNotes from '../components/ReleaseNotes';
import { isNative } from '../lib/native';
import { formatDate, timeAgo } from '../lib/format';

function UpdateRow({ app, info }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div className="card p-3.5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/app/${app.id}`)} className="shrink-0">
          <AppIcon app={app} size={48} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-semibold text-white">
            {app.name}
            {isRequired(app, info) && (
              <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-400">{t('required.badge', 'Required')}</span>
            )}
          </p>
          <p className="text-xs text-zinc-500">
            v{info?.versionName} → <span className="text-zinc-300">v{app.latest?.version}</span>
          </p>
        </div>
        <AppActionButton app={app} compact />
      </div>
      {app.latest?.notes?.trim() && (
        <>
          <button onClick={() => setOpen(!open)} className="mt-2 flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-white">
            {t('updates.whatsNew', "What's new")} <ChevronDown size={12} className={open ? 'rotate-180' : ''} />
          </button>
          {open && <ReleaseNotes text={app.latest.notes} className="mt-2" />}
        </>
      )}
    </div>
  );
}

function Feed({ apps }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const items = apps
    .flatMap((a) => (a.releases || []).map((r) => ({ app: a, r })))
    .sort((x, y) => Date.parse(y.r.publishedAt) - Date.parse(x.r.publishedAt))
    .slice(0, 25);
  if (!items.length) return <p className="text-sm text-zinc-500">{t('updates.noReleases', 'No releases yet.')}</p>;
  return (
    <div className="card divide-y divide-zinc-800">
      {items.map(({ app, r }) => {
        const key = `${app.id}@${r.tag}`;
        return (
          <div key={key} className="p-3">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(`/app/${app.id}`)} className="shrink-0">
                <AppIcon app={app} size={36} />
              </button>
              <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === key ? null : key)}>
                <p className="truncate text-sm font-medium text-zinc-100">
                  {app.name} <span className="text-zinc-500">v{r.version}</span>
                </p>
                <p className="text-xs text-zinc-500">{formatDate(r.publishedAt, i18n.language)}</p>
              </button>
              {r.notes?.trim() && (
                <ChevronDown size={14} className={`shrink-0 text-zinc-500 transition-transform ${open === key ? 'rotate-180' : ''}`} />
              )}
            </div>
            {open === key && r.notes?.trim() && <ReleaseNotes text={r.notes} className="mt-2 pl-12" />}
          </div>
        );
      })}
    </div>
  );
}

export default function Updates() {
  const { t } = useTranslation();
  const { apps, load, loading, syncedAt } = useCatalogStore();
  const installed = useDeviceStore((s) => s.installed);
  const refresh = useDeviceStore((s) => s.refresh);
  const updateAll = useDeviceStore((s) => s.updateAll);
  const queueRunning = useDeviceStore((s) => s.queueRunning);
  const updatable = useUpdatable(apps);
  const native = isNative();

  const upToDate = native ? apps.filter((a) => installed[a.packageName]?.installed && !updatable.includes(a)) : [];

  const checkNow = async () => {
    await load();
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{t('updates.title', 'Updates')}</h1>
          {syncedAt && <p className="text-xs text-zinc-500">{t('updates.checked', 'Checked {{when}}', { when: timeAgo(syncedAt, t) })}</p>}
        </div>
        <button className="btn-secondary" onClick={checkNow} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> {t('updates.checkNow', 'Check now')}
        </button>
      </div>

      {native && (
        <section>
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="section-title mb-0">{t('updates.available', 'Available updates')}</h2>
            {updatable.length > 1 && (
              <button className="btn-primary px-3 py-1.5 text-xs" disabled={queueRunning} onClick={() => updateAll(updatable)}>
                {queueRunning ? t('updates.updating', 'Updating…') : t('updates.updateAll', 'Update all')}
              </button>
            )}
          </div>
          {updatable.length ? (
            <div className="space-y-2">
              {updatable.map((a) => (
                <UpdateRow key={a.id} app={a} info={installed[a.packageName]} />
              ))}
            </div>
          ) : (
            <div className="card flex items-center gap-3 p-4 text-sm text-zinc-300">
              <CheckCircle2 size={20} className="text-emerald-400" /> {t('updates.allGood', 'All your Quarc apps are up to date.')}
            </div>
          )}
        </section>
      )}

      {upToDate.length > 0 && (
        <section>
          <h2 className="section-title">{t('updates.upToDate', 'Up to date')}</h2>
          <div className="card divide-y divide-zinc-800">
            {upToDate.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-3">
                <AppIcon app={a} size={36} />
                <p className="flex-1 text-sm text-zinc-200">{a.name}</p>
                <span className="text-xs text-zinc-500">v{installed[a.packageName]?.versionName}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">{t('updates.recent', 'Recent releases across Quarc')}</h2>
        <Feed apps={apps} />
      </section>
    </div>
  );
}
