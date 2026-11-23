import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, RefreshCw, UserRound, Shield, ShieldCheck } from 'lucide-react';
import useAuthStore from '../store/authStore';
import useCatalogStore from '../store/catalogStore';
import useDeviceStore, { useUpdatable } from '../store/deviceStore';
import { isAndroid } from '../lib/native';

function Tab({ to, icon: Icon, label, badge }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors md:flex-none md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-sm ${
          isActive ? 'text-white md:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-200'
        }`
      }
    >
      <span className="relative">
        <Icon size={20} className="md:h-4 md:w-4" />
        {badge > 0 && (
          <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-accent px-1 text-center text-[10px] font-bold leading-4 text-white">
            {badge}
          </span>
        )}
      </span>
      {label}
    </NavLink>
  );
}

function InstallPermissionBanner() {
  const { t } = useTranslation();
  const needs = useDeviceStore((s) => s.needsInstallPermission);
  const open = useDeviceStore((s) => s.openInstallSettings);
  if (!needs) return null;
  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
      <p className="font-medium">{t('perm.title', 'Allow Quarc Store to install apps')}</p>
      <p className="mt-0.5 text-amber-200/80">
        {t('perm.body', 'Android needs your permission once. Turn on "Allow from this source", then come back.')}
      </p>
      <button className="btn mt-2 bg-amber-500/20 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-500/30" onClick={open}>
        {t('perm.open', 'Open settings')}
      </button>
    </div>
  );
}

export default function Layout() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const apps = useCatalogStore((s) => s.apps);
  const updates = useUpdatable(apps);

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="" className="h-7 w-7" />
            <span className="text-lg font-bold tracking-tight text-white">Quarc Store</span>
          </div>
          <nav className="hidden items-center gap-1 md:flex">
            <Tab to="/" icon={LayoutGrid} label={t('nav.apps', 'Apps')} />
            <Tab to="/updates" icon={RefreshCw} label={t('nav.updates', 'Updates')} badge={updates.length} />
            <Tab to="/account" icon={UserRound} label={t('nav.account', 'Account')} />
            {user?.role === 'admin' && <Tab to="/admin" icon={Shield} label={t('nav.admin', 'Admin')} />}
          </nav>
          {user ? (
            <NavLink to="/account" className="flex items-center gap-1.5 rounded-full bg-zinc-900 py-1 pl-1.5 pr-3 text-xs text-zinc-300 md:hidden">
              <ShieldCheck size={14} className="text-emerald-400" />
              {user.username}
            </NavLink>
          ) : (
            <NavLink to="/account" className="text-xs font-semibold text-accent md:hidden">
              {t('auth.signIn', 'Sign in')}
            </NavLink>
          )}
        </div>
      </header>

      {isAndroid() && <InstallPermissionBanner />}

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-4 md:pb-10">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-900 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <Tab to="/" icon={LayoutGrid} label={t('nav.apps', 'Apps')} />
        <Tab to="/updates" icon={RefreshCw} label={t('nav.updates', 'Updates')} badge={updates.length} />
        <Tab to="/account" icon={UserRound} label={t('nav.account', 'Account')} />
        {user?.role === 'admin' && <Tab to="/admin" icon={Shield} label={t('nav.admin', 'Admin')} />}
      </nav>
    </div>
  );
}
