import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, KeyRound, Github, Globe, Trash2, Download, ChevronDown } from 'lucide-react';
import useCatalogStore from '../store/catalogStore';
import useDeviceStore, { useAppStatus, isRequired } from '../store/deviceStore';
import { api } from '../lib/api';
import { isDesktop, isNative, openExternal, platformAsset } from '../lib/native';
import { formatBytes, formatDate } from '../lib/format';
import AppIcon from '../components/AppIcon';
import AppActionButton from '../components/AppActionButton';
import PlatformBadges from '../components/PlatformBadges';
import ReleaseNotes from '../components/ReleaseNotes';

const DOWNLOAD_LABELS = {
  android: 'Android (APK)',
  windows: 'Windows',
  'macos-arm': 'macOS (Apple Silicon)',
  'macos-intel': 'macOS (Intel)',
  'linux-deb': 'Linux (.deb)',
  'linux-appimage': 'Linux (AppImage)',
  'linux-rpm': 'Linux (.rpm)',
};

function Downloads({ release }) {
  const entries = Object.entries(release.assets || {});
  const other = release.otherAssets || [];
  if (!entries.length && !other.length) return null;
  return (
    <div className="divide-y divide-zinc-800">
      {[...entries.map(([k, a]) => [DOWNLOAD_LABELS[k] || k, a]), ...other.map((a) => [a.name, a])].map(([label, a]) => (
        <button
          key={a.url}
          onClick={() => openExternal(a.url)}
          className="flex w-full items-center justify-between gap-3 py-2.5 text-left text-sm hover:text-white"
        >
          <span className="flex items-center gap-2 text-zinc-300">
            <Download size={14} className="text-zinc-500" /> {label}
          </span>
          <span className="text-xs text-zinc-600">{formatBytes(a.size)}</span>
        </button>
      ))}
    </div>
  );
}

function History({ releases, lang }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(null);
  if (!releases.length) return null;
  return (
    <div className="divide-y divide-zinc-800">
      {releases.map((r) => (
        <div key={r.tag} className="py-2.5">
          <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(open === r.tag ? null : r.tag)}>
            <span className="text-sm font-medium text-zinc-200">v{r.version}</span>
            <span className="flex items-center gap-2 text-xs text-zinc-500">
              {formatDate(r.publishedAt, lang)}
              <ChevronDown size={14} className={`transition-transform ${open === r.tag ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {open === r.tag && (
            <div className="mt-2">
              {r.notes?.trim() ? <ReleaseNotes text={r.notes} /> : <p className="text-sm text-zinc-600">{t('detail.noNotes', 'No release notes.')}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AppDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const fromCatalog = useCatalogStore((s) => s.apps.find((a) => a.id === id || a.packageName === id) || null);
  const catalogLoaded = useCatalogStore((s) => s.loaded);
  const [full, setFull] = useState(null);
  const app = full || fromCatalog;
  const { status, info } = useAppStatus(app);
  const uninstall = useDeviceStore((s) => s.uninstall);
  const native = isNative();

  useEffect(() => {
    if (!fromCatalog) return;
    api(`/api/store/apps/${fromCatalog.id}`).then(setFull).catch(() => {});
  }, [fromCatalog?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app && !catalogLoaded) {
    return <p className="py-16 text-center text-sm text-zinc-500">{t('home.loading', 'Loading apps…')}</p>;
  }
  if (!app) {
    return (
      <div className="py-16 text-center text-sm text-zinc-500">
        <p>{t('detail.notFound', 'App not found.')}</p>
        <button className="btn-secondary mt-3" onClick={() => navigate('/')}>{t('action.back', 'Back')}</button>
      </div>
    );
  }

  const latest = app.latest;
  const installAsset = platformAsset(latest);
  // The Windows Store can update itself, but not remove itself.
  const isSelfOnDesktop = isDesktop() && app.packageName === 'com.quarc.store';

  return (
    <div className="space-y-5">
      <button onClick={() => navigate(-1)} className="btn-ghost -ml-2 px-2 py-1.5">
        <ArrowLeft size={16} /> {t('action.back', 'Back')}
      </button>

      <div className="flex items-start gap-4">
        <AppIcon app={app} size={76} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight text-white">{app.name}</h1>
          <p className="mt-0.5 text-sm text-zinc-400">{app.tagline}</p>
          <div className="mt-2"><PlatformBadges platforms={app.platforms} /></div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AppActionButton app={app} />
        {native && info?.installed && !isSelfOnDesktop && (
          <button className="btn-ghost" onClick={() => uninstall(app)}>
            <Trash2 size={14} /> {t('action.uninstall', 'Uninstall')}
          </button>
        )}
        {app.webUrl && status !== 'web' && (
          <button className="btn-ghost" onClick={() => openExternal(app.webUrl)}>
            <Globe size={14} /> {t('detail.webVersion', 'Web version')}
          </button>
        )}
      </div>

      <div className="card grid grid-cols-2 gap-px overflow-hidden bg-zinc-800 sm:grid-cols-4">
        {[
          [t('detail.latest', 'Latest'), latest ? `v${latest.version}` : '—'],
          native && app.packageName ? [t('detail.installed', 'Installed'), info?.installed ? `v${info.versionName}` : t('detail.notInstalled', 'No')] : null,
          [t('detail.released', 'Released'), latest ? formatDate(latest.publishedAt, i18n.language) : '—'],
          installAsset ? [t('detail.size', 'Size'), formatBytes(installAsset.size)] : null,
        ]
          .filter(Boolean)
          .map(([k, v]) => (
            <div key={k} className="bg-zinc-900 px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</p>
              <p className="mt-0.5 text-sm font-medium text-zinc-100">{v}</p>
            </div>
          ))}
      </div>

      {isRequired(app, info) && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {t('required.detail', 'Version {{installed}} is no longer supported. Update to keep using {{name}}.', {
            installed: info.versionName,
            name: app.name,
          })}
        </div>
      )}

      {app.sso && !isDesktop() && (
        <div className="flex gap-2.5 rounded-xl border border-accent/30 bg-accent-soft p-3 text-sm text-emerald-200">
          <KeyRound size={18} className="mt-0.5 shrink-0 text-accent" />
          <p>{t('detail.sso', 'Uses your Quarc account. When you are signed in to Quarc Store on this phone, this app signs you in automatically.')}</p>
        </div>
      )}
      {native && info?.installed && info.silentUpdates && (
        <p className="text-xs text-zinc-500">{t('detail.silent', 'Quarc Store manages this app: future updates install without extra prompts.')}</p>
      )}

      {app.description && <p className="text-sm leading-relaxed text-zinc-300">{app.description}</p>}

      {latest?.notes?.trim() && (
        <section>
          <h2 className="section-title">{t('detail.whatsNew', "What's new in v{{version}}", { version: latest.version })}</h2>
          <div className="card p-4"><ReleaseNotes text={latest.notes} /></div>
        </section>
      )}

      {latest && (Object.keys(latest.assets || {}).length > 0 || latest.otherAssets?.length > 0) && (
        <section>
          <h2 className="section-title">{t('detail.downloads', 'Downloads for every platform')}</h2>
          <div className="card px-4 py-1"><Downloads release={latest} /></div>
        </section>
      )}

      {app.releases?.length > 1 && (
        <section>
          <h2 className="section-title">{t('detail.history', 'Version history')}</h2>
          <div className="card px-4 py-1"><History releases={app.releases} lang={i18n.language} /></div>
        </section>
      )}

      {!latest && !app.webUrl && (
        <p className="text-sm text-zinc-500">{t('detail.noRelease', 'No published release yet.')}</p>
      )}

      <div className="flex flex-wrap gap-2 pb-4">
        {app.repoUrl && (
          <button className="btn-ghost" onClick={() => openExternal(app.repoUrl)}>
            <Github size={14} /> {t('detail.source', 'Source on GitHub')}
          </button>
        )}
        {app.packageName && <span className="self-center text-xs text-zinc-600">{app.packageName}</span>}
      </div>
    </div>
  );
}
