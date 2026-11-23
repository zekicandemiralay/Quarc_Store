import { create } from 'zustand';
import { storeNative, removeListener, platformAsset } from '../lib/native';
import { compareVersions } from '../lib/format';

// What's installed on this device (Android or Windows), and installs in progress.
// Every method is a harmless no-op on the web.

// Resolvers for install() promises, settled by native installProgress events.
const waiters = new Map();
let listenerHandle = null;

const FINAL = new Set(['done', 'failed', 'cancelled']);

const useDeviceStore = create((set, get) => ({
  installed: {}, // packageName → { installed, versionName, versionCode, byStore, silentUpdates }
  tasks: {}, // packageName → { phase, progress, message }
  knownPackages: [],
  needsInstallPermission: false,
  queueRunning: false,

  init() {
    const native = storeNative();
    if (!native || listenerHandle) return;
    listenerHandle = native.addListener('installProgress', (e) => {
      const { packageName, phase, progress, message } = e;
      set((s) => ({ tasks: { ...s.tasks, [packageName]: { phase, progress, message } } }));
      if (FINAL.has(phase)) {
        const w = waiters.get(packageName);
        if (w) {
          waiters.delete(packageName);
          w({ phase, message });
        }
        get().refresh();
        // Leave a finished/failed state visible briefly, then clear it.
        setTimeout(() => {
          set((s) => {
            const t = { ...s.tasks };
            if (t[packageName]?.phase === phase) delete t[packageName];
            return { tasks: t };
          });
        }, phase === 'failed' ? 8000 : 2500);
      }
    });
  },

  dispose() {
    if (listenerHandle) removeListener(listenerHandle);
    listenerHandle = null;
  },

  async refresh(packages) {
    const native = storeNative();
    if (!native) return;
    const list = packages || get().knownPackages || [];
    if (packages) set({ knownPackages: packages });
    if (!list.length) return;
    try {
      const { apps } = await native.getInstalled({ packages: list });
      set({ installed: apps || {} });
    } catch {
      /* keep previous */
    }
  },

  async checkInstallPermission() {
    const native = storeNative();
    if (!native) return true;
    const { allowed } = await native.canInstall().catch(() => ({ allowed: true }));
    set({ needsInstallPermission: !allowed });
    return allowed;
  },

  openInstallSettings() {
    storeNative()?.openInstallSettings().catch(() => {});
  },

  /** Installs or updates an app. Resolves when the device reports the outcome. */
  async install(app) {
    const native = storeNative();
    const asset = platformAsset(app.latest);
    if (!native || !asset || !app.packageName) return { phase: 'failed', message: 'Not installable here' };
    if (!(await get().checkInstallPermission())) return { phase: 'needs-permission' };

    const done = new Promise((resolve) => waiters.set(app.packageName, resolve));
    set((s) => ({ tasks: { ...s.tasks, [app.packageName]: { phase: 'queued', progress: 0 } } }));
    try {
      await native.install({ url: asset.url, packageName: app.packageName, version: app.latest.version, label: app.name });
    } catch (err) {
      waiters.delete(app.packageName);
      set((s) => ({ tasks: { ...s.tasks, [app.packageName]: { phase: 'failed', message: err.message } } }));
      return { phase: 'failed', message: err.message };
    }
    return done;
  },

  cancel(packageName) {
    storeNative()?.cancelInstall({ packageName }).catch(() => {});
  },

  /**
   * Called when the user comes back to the Store. Android normally reports
   * the outcome of its install dialog (installed / cancelled), but if one
   * never arrives, don't leave the app stuck on "Confirm…" — and don't block
   * an "Update all" queue behind it.
   */
  settleStaleConfirms() {
    for (const [pkg, task] of Object.entries(get().tasks)) {
      if (task.phase !== 'confirm') continue;
      setTimeout(() => {
        if (get().tasks[pkg]?.phase !== 'confirm') return;
        set((s) => {
          const t = { ...s.tasks };
          delete t[pkg];
          return { tasks: t };
        });
        const w = waiters.get(pkg);
        if (w) {
          waiters.delete(pkg);
          w({ phase: 'cancelled' });
        }
        get().refresh();
      }, 15000);
    }
  },

  /** Updates apps one after another (Android's confirmations would pile up; Windows runs one installer at a time). */
  async updateAll(apps) {
    if (get().queueRunning) return;
    set({ queueRunning: true });
    try {
      // The Store replaces itself last: once it does, it restarts and the rest of the queue is gone.
      const self = (a) => a.packageName === 'com.quarc.store';
      for (const app of [...apps].sort((a, b) => self(a) - self(b))) {
        const r = await get().install(app);
        if (r.phase === 'needs-permission') break;
      }
    } finally {
      set({ queueRunning: false });
    }
  },

  uninstall(app) {
    // Android hands over to the system's remove dialog and comes back through a resume;
    // Windows removes the app itself and settles when it is gone. Either way, look again after.
    storeNative()
      ?.uninstall({ packageName: app.packageName })
      .then(() => get().refresh())
      .catch(() => get().refresh());
  },

  launch(app) {
    return storeNative()?.launch({ packageName: app.packageName });
  },
}));

/**
 * Where an app stands on this device:
 * 'web' (no Android build, has a web version) | 'none' | 'install' | 'update' | 'open' | 'busy'
 */
export function appStatus(app, info, task) {
  if (!app.packageName) return app.webUrl ? 'web' : 'none';
  if (task && !FINAL.has(task.phase)) return 'busy';
  const apk = platformAsset(app.latest);
  if (!info?.installed) return apk ? 'install' : app.webUrl ? 'web' : 'none';
  if (apk && compareVersions(app.latest.version, info.versionName) > 0) return 'update';
  return 'open';
}

/** Installed, but older than the minimum version the admin still allows. */
export function isRequired(app, info) {
  return !!(app?.minVersion && info?.installed && compareVersions(info.versionName, app.minVersion) < 0);
}

/** appStatus() for one app, re-rendering only when that app's state changes. */
export function useAppStatus(app) {
  const info = useDeviceStore((s) => (app?.packageName ? s.installed[app.packageName] : undefined));
  const task = useDeviceStore((s) => (app?.packageName ? s.tasks[app.packageName] : undefined));
  return { status: app ? appStatus(app, info, task) : 'none', info, task };
}

/** Apps in the catalog with an update available on this device. */
export function useUpdatable(apps) {
  const installed = useDeviceStore((s) => s.installed);
  const tasks = useDeviceStore((s) => s.tasks);
  return apps
    .filter((a) => {
      const st = appStatus(a, installed[a.packageName], tasks[a.packageName]);
      return st === 'update' || (st === 'busy' && installed[a.packageName]?.installed);
    })
    // Required updates first.
    .sort((x, y) => isRequired(y, installed[y.packageName]) - isRequired(x, installed[x.packageName]));
}

export default useDeviceStore;
