import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import useAuthStore from './store/authStore';
import useCatalogStore from './store/catalogStore';
import useDeviceStore from './store/deviceStore';
import { appPlugin, removeListener } from './lib/native';
import Layout from './components/Layout';
import Toasts from './components/Toasts';
import ApprovalWatcher from './components/ApprovalWatcher';
import Apps from './pages/Apps';
import AppDetail from './pages/AppDetail';
import Updates from './pages/Updates';
import Account from './pages/Account';
import Admin from './pages/Admin';

/**
 * quarcstore:// links, used by other Quarc apps and by update notifications:
 *   quarcstore://login?return=com.quarc.music  → sign in, then go back to that app
 *   quarcstore://app/com.quarc.music           → that app's page (id or package name)
 *   quarcstore://updates                       → the Updates tab
 */
export function routeForDeepLink(url) {
  const rest = String(url || '').replace(/^quarcstore:\/\//i, '');
  if (rest === url) return null;
  const [path, query = ''] = rest.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'login':
    case 'account': {
      const ret = params.get('return');
      return ret && /^[\w.]+$/.test(ret) ? `/account?return=${encodeURIComponent(ret)}` : '/account';
    }
    case 'app':
      return parts[1] ? `/app/${encodeURIComponent(parts[1])}` : '/';
    case 'updates':
      return '/updates';
    default:
      return '/';
  }
}

export default function App() {
  const navigate = useNavigate();
  const checkSession = useAuthStore((s) => s.checkSession);
  const loadCatalog = useCatalogStore((s) => s.load);
  const packages = useCatalogStore((s) =>
    s.apps
      .map((a) => a.packageName)
      .filter(Boolean)
      .join(',')
  );

  useEffect(() => {
    const device = useDeviceStore.getState();
    device.init();
    device.checkInstallPermission();
    checkSession();
    loadCatalog();
    return () => useDeviceStore.getState().dispose();
  }, [checkSession, loadCatalog]);

  useEffect(() => {
    if (packages) useDeviceStore.getState().refresh(packages.split(','));
  }, [packages]);

  // Coming back to the Store (e.g. from Android's installer or settings):
  // re-read installed versions, the install permission, and the session.
  useEffect(() => {
    const app = appPlugin();
    if (!app) return undefined;
    const handle = app.addListener('resume', () => {
      const device = useDeviceStore.getState();
      device.refresh();
      device.checkInstallPermission();
      device.settleStaleConfirms();
      checkSession();
    });
    return () => removeListener(handle);
  }, [checkSession]);

  useEffect(() => {
    const app = appPlugin();
    if (!app) return undefined;
    const go = (url) => {
      const route = routeForDeepLink(url);
      if (route) navigate(route);
    };
    app.getLaunchUrl?.().then((r) => r?.url && go(r.url)).catch(() => {});
    const handle = app.addListener('appUrlOpen', (e) => go(e.url));
    return () => removeListener(handle);
  }, [navigate]);

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Apps />} />
          <Route path="app/:id" element={<AppDetail />} />
          <Route path="updates" element={<Updates />} />
          <Route path="account" element={<Account />} />
          <Route path="login" element={<Navigate to="/account" replace />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <ApprovalWatcher />
      <Toasts />
    </>
  );
}
