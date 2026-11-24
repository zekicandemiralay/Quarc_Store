import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Smartphone, Monitor, KeyRound, ShieldCheck, X, Bell, Languages } from 'lucide-react';
import useAuthStore from '../store/authStore';
import useCatalogStore from '../store/catalogStore';
import { api } from '../lib/api';
import { isDesktop, isNative, ssoHost, storeNative } from '../lib/native';
import { timeAgo } from '../lib/format';
import { toast } from '../store/toastStore';
import LoginForm from '../components/LoginForm';
import Modal from '../components/Modal';
import AppIcon from '../components/AppIcon';

function useAppName() {
  const apps = useCatalogStore((s) => s.apps);
  return useCallback(
    (client) => {
      if (client === 'quarc-store') return 'Quarc Store (Android)';
      if (client === 'quarc-store-windows') return 'Quarc Store (Windows)';
      const app = apps.find((a) => a.packageName === client);
      return app ? app.name : client;
    },
    [apps]
  );
}

function DeviceSso() {
  const { t } = useTranslation();
  const apps = useCatalogStore((s) => s.apps);
  const [clients, setClients] = useState([]);
  useEffect(() => {
    ssoHost()
      ?.listClients()
      .then((r) => setClients(r.clients || []))
      .catch(() => {});
  }, []);
  const known = clients
    .map((c) => ({ ...c, app: apps.find((a) => a.packageName === c.packageName) }))
    .filter((c) => c.app);
  return (
    <section className="card p-4">
      <div className="flex gap-3">
        <ShieldCheck className="mt-0.5 shrink-0 text-emerald-400" size={20} />
        <div>
          <p className="text-sm font-semibold text-white">
            {isDesktop() ? t('account.ssoOnPc', 'Single sign-on is on for this PC') : t('account.ssoOn', 'Single sign-on is on for this phone')}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {isDesktop()
              ? t('account.ssoBodyPc', 'Quarc apps on this PC sign in with this account automatically. Signing out here signs them out too.')
              : t('account.ssoBody', 'Quarc apps on this phone sign in with this account automatically. Signing out here signs them out too.')}
          </p>
        </div>
      </div>
      {known.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 pl-8">
          {known.map((c) => (
            <span key={c.packageName} className="flex items-center gap-1.5 rounded-full bg-zinc-800 py-1 pl-1 pr-2.5 text-xs text-zinc-300">
              <AppIcon app={c.app} size={18} /> {c.app.name}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Sessions() {
  const { t } = useTranslation();
  const appName = useAppName();
  const refreshDeviceSession = useAuthStore((s) => s.refreshDeviceSession);
  const [data, setData] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(() => {
    api('/api/auth/sessions')
      .then(setData)
      .catch(() => setData({ sessions: [], error: true }));
  }, []);
  useEffect(load, [load]);

  async function revoke(id) {
    try {
      await api(`/api/auth/sessions/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  }
  async function revokeAll() {
    setConfirmAll(false);
    try {
      await api('/api/auth/sessions/revoke-all', { method: 'POST', body: { keepCurrent: true } });
      await refreshDeviceSession();
      toast(t('account.signedOutOthers', 'Signed out everywhere else'), { tone: 'success' });
      load();
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  }

  if (!data) return <p className="text-sm text-zinc-500">{t('account.loadingSessions', 'Loading…')}</p>;
  if (data.error) return <p className="text-sm text-zinc-500">{t('account.sessionsUnavailable', "Couldn't load your sessions.")}</p>;

  const roots = data.sessions.filter((s) => !s.parentId || !data.sessions.some((p) => p.id === s.parentId));
  const childrenOf = (id) => data.sessions.filter((s) => s.parentId === id);

  return (
    <>
      <div className="card divide-y divide-zinc-800">
        {roots.map((s) => {
          const kids = childrenOf(s.id);
          const mobile = !/windows/i.test(`${s.client} ${s.device}`) && (/android|quarc-store|iphone|ipad/i.test(`${s.client} ${s.device}`) || kids.length > 0);
          return (
            <div key={s.id} className="p-3.5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 text-zinc-500">{mobile ? <Smartphone size={18} /> : <Monitor size={18} />}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-100">
                    {s.device || t('account.unknownDevice', 'Unknown device')}
                    {s.current && <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">{t('account.thisDevice', 'This device')}</span>}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {appName(s.client)} · {timeAgo(s.lastSeenAt, t)}
                  </p>
                  {kids.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {t('account.signedInApps', 'Also signed in: {{apps}}', { apps: kids.map((k) => appName(k.client)).join(', ') })}
                    </p>
                  )}
                </div>
                {!s.current && (
                  <button onClick={() => revoke(s.id)} className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400" aria-label={t('account.signOutSession', 'Sign out')}>
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {!roots.length && <p className="p-4 text-sm text-zinc-500">{t('account.noSessions', 'No other sessions.')}</p>}
      </div>
      {data.legacy && (
        <p className="mt-2 px-1 text-xs text-zinc-500">{t('account.legacy', 'Sign in again to see and manage this session here.')}</p>
      )}
      {roots.length > 1 && (
        <button className="btn-danger mt-3" onClick={() => setConfirmAll(true)}>
          {t('account.signOutEverywhere', 'Sign out everywhere else')}
        </button>
      )}
      {confirmAll && (
        <Modal title={t('account.signOutEverywhere', 'Sign out everywhere else')} onClose={() => setConfirmAll(false)}>
          <p className="text-sm text-zinc-400">{t('account.signOutEverywhereBody', 'Every other phone, computer and browser using your Quarc account will be signed out of every Quarc app. This device stays signed in.')}</p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setConfirmAll(false)}>{t('action.cancel', 'Cancel')}</button>
            <button className="btn-danger" onClick={revokeAll}>{t('account.signOutAll', 'Sign them out')}</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ChangePassword() {
  const { t } = useTranslation();
  const refreshDeviceSession = useAuthStore((s) => s.refreshDeviceSession);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [others, setOthers] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (next.length < 8) return toast(t('auth.passwordMinLength', 'Password must be at least 8 characters'), { tone: 'error' });
    if (next !== confirm) return toast(t('auth.passwordsNoMatch', "Passwords don't match"), { tone: 'error' });
    setBusy(true);
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next, signOutOthers: others } });
      if (others) await refreshDeviceSession();
      setCurrent('');
      setNext('');
      setConfirm('');
      toast(t('account.passwordChanged', 'Password changed'), { tone: 'success' });
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <input className="input" type="password" placeholder={t('account.currentPassword', 'Current password')} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      <input className="input" type="password" placeholder={t('account.newPassword', 'New password')} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
      <input className="input" type="password" placeholder={t('auth.confirmPassword', 'Confirm password')} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} className="accent-emerald-600" />
        {t('account.signOutOthersToo', 'Sign out my other devices')}
      </label>
      <button className="btn-primary" disabled={busy}>{t('account.changePassword', 'Change password')}</button>
    </form>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-zinc-700'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function Settings() {
  const { t, i18n } = useTranslation();
  const [s, setS] = useState(null);
  const native = isNative();

  useEffect(() => {
    storeNative()?.getSettings().then(setS).catch(() => {});
  }, []);

  async function update(patch) {
    const nextS = { ...s, ...patch };
    setS(nextS);
    if (patch.checks || patch.autoInstall) {
      const r = await storeNative()?.requestNotifications().catch(() => null);
      if (r && !r.granted) toast(t('settings.notifDenied', 'Notifications are off — you will only see updates inside the Store.'));
    }
    await storeNative()?.setBackgroundUpdates({ checks: nextS.checks, autoInstall: nextS.autoInstall }).catch(() => {});
  }

  function setLanguage(lng) {
    i18n.changeLanguage(lng);
    try {
      localStorage.setItem('language', lng);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="card divide-y divide-zinc-800">
      <div className="flex items-center justify-between gap-3 p-4">
        <span className="flex items-center gap-2.5 text-sm text-zinc-200"><Languages size={16} className="text-zinc-500" /> {t('settings.language', 'Language')}</span>
        <select value={i18n.language?.slice(0, 2)} onChange={(e) => setLanguage(e.target.value)} className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-white">
          <option value="en">English</option>
          <option value="tr">Türkçe</option>
        </select>
      </div>
      {native && s && (
        <>
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="flex items-center gap-2.5 text-sm text-zinc-200"><Bell size={16} className="text-zinc-500" /> {t('settings.checks', 'Notify me about updates')}</p>
              <p className="mt-0.5 pl-[26px] text-xs text-zinc-500">{t('settings.checksBody', 'Checks in the background a few times a day.')}</p>
            </div>
            <Toggle checked={!!s.checks} onChange={(v) => update({ checks: v, autoInstall: v ? s.autoInstall : false })} />
          </div>
          <div className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="pl-[26px] text-sm text-zinc-200">{t('settings.auto', 'Install updates automatically')}</p>
              <p className="mt-0.5 pl-[26px] text-xs text-zinc-500">
                {s.sdk >= 31
                  ? t('settings.autoBody', 'For apps installed or updated through Quarc Store. Others still ask first.')
                  : t('settings.autoOld', 'Needs Android 12 or newer.')}
              </p>
            </div>
            <Toggle checked={!!s.autoInstall} disabled={!s.checks || s.sdk < 31} onChange={(v) => update({ autoInstall: v })} />
          </div>
        </>
      )}
    </div>
  );
}

export default function Account() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [params, setParams] = useSearchParams();
  const [confirmOut, setConfirmOut] = useState(false);
  // Single sign-on: Android and Windows. ("This device" is the phone or the PC.)
  const native = isNative();
  const returnTo = params.get('return');

  // Arrived from another app ("Sign in with Quarc Store") while already signed in: go straight back.
  useEffect(() => {
    if (user && returnTo && native) {
      setParams({}, { replace: true });
      storeNative()?.launch({ packageName: returnTo }).catch(() => {});
    }
  }, [user, returnTo, native, setParams]);

  if (!user) {
    return (
      <div className="space-y-8 pt-4">
        <LoginForm />
        <section>
          <h2 className="section-title">{t('settings.title', 'Settings')}</h2>
          <Settings />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3.5">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-xl font-bold text-white">
          {user.username.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="text-lg font-semibold text-white">{user.username}</p>
          <p className="flex items-center gap-1 text-xs text-zinc-500">
            <KeyRound size={12} /> {user.role === 'admin' ? t('account.admin', 'Administrator') : t('account.member', 'Quarc account')}
          </p>
        </div>
      </div>

      {native && <DeviceSso />}

      <section>
        <h2 className="section-title">{t('account.sessions', 'Where you are signed in')}</h2>
        <Sessions />
      </section>

      <section>
        <h2 className="section-title">{t('account.password', 'Password')}</h2>
        <ChangePassword />
      </section>

      <section>
        <h2 className="section-title">{t('settings.title', 'Settings')}</h2>
        <Settings />
      </section>

      <button className="btn-danger w-full rounded-xl py-3" onClick={() => (native ? setConfirmOut(true) : logout())}>
        <LogOut size={16} /> {t('auth.signOut', 'Sign out')}
      </button>

      {confirmOut && (
        <Modal title={t('auth.signOut', 'Sign out')} onClose={() => setConfirmOut(false)}>
          <p className="text-sm text-zinc-400">
            {isDesktop()
              ? t('account.signOutBodyPc', 'This signs you out of Quarc Store and of every Quarc app on this PC.')
              : t('account.signOutBody', 'This signs you out of Quarc Store and of every Quarc app on this phone.')}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setConfirmOut(false)}>{t('action.cancel', 'Cancel')}</button>
            <button
              className="btn-danger"
              onClick={async () => {
                setConfirmOut(false);
                await logout();
              }}
            >
              {t('auth.signOut', 'Sign out')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
