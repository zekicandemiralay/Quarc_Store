import { create } from 'zustand';
import { api, API_BASE } from '../lib/api';
import { storeNative } from '../lib/native';

const LS_KEY = 'quarc_store_catalog';

function cached() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch {
    return null;
  }
}

/**
 * The native side needs a small slice of the catalog: which packages are
 * Quarc apps, which may receive a login, their signing fingerprints, and the
 * latest APK — for verifying SSO callers and for background update checks.
 */
function nativeSlice(catalog) {
  return {
    syncedAt: catalog.syncedAt,
    apps: catalog.apps
      .filter((a) => a.packageName)
      .map((a) => ({
        id: a.id,
        name: a.name,
        packageName: a.packageName,
        sso: a.sso,
        certSha256: a.certSha256,
        minVersion: a.minVersion,
        latest: a.latest?.assets?.android
          ? { version: a.latest.version, url: a.latest.assets.android.url }
          : null,
      })),
  };
}

const initial = cached();

const useCatalogStore = create((set, get) => ({
  apps: initial?.apps || [],
  syncedAt: initial?.syncedAt || null,
  loaded: !!initial,
  loading: false,
  error: null,

  async load() {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const data = await api('/api/store/catalog');
      set({ apps: data.apps, syncedAt: data.syncedAt, loaded: true, loading: false });
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
      } catch {
        /* quota — the in-memory copy is enough */
      }
      await storeNative()
        ?.setCatalog({ json: JSON.stringify(nativeSlice(data)), origin: API_BASE })
        .catch(() => {});
    } catch (err) {
      set({ loading: false, error: err.message });
    }
  },
}));

export default useCatalogStore;
