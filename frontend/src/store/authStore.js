import { create } from 'zustand';
import { api, apiUrl, API_BASE } from '../lib/api';
import { isAndroid, isDesktop, isMac, ssoHost, storeNative } from '../lib/native';

// The Store's own login. On Android it is also *the device's* Quarc login (on Windows each app keeps its own):
// after every successful login/session check the session is handed to the
// native SSO host (QuarcSsoHost), which is where other Quarc apps on this
// phone get theirs from. Signing out here signs those apps out too.

const LS_KEY = 'quarc_store_user';

const cachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch {
    return null;
  }
};
const saveUser = (u) => {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(u));
  } catch {
    /* storage unavailable */
  }
};
const clearUser = () => {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* storage unavailable */
  }
};

async function shareWithDevice(user) {
  await ssoHost()?.syncSession({ serverOrigin: API_BASE, user }).catch(() => {});
}
async function signOutDevice() {
  await ssoHost()?.signOut().catch(() => {});
}

async function loginBody(username, password) {
  const body = { username, password };
  if (isAndroid()) {
    // Only sessions created with this client label may sign in other apps.
    body.client = 'quarc-store';
    const info = await storeNative()?.deviceInfo().catch(() => null);
    if (info?.model) body.device = info.model;
  } else if (isDesktop()) {
    // A different label on purpose: only the phone's Store session may approve a computer's sign-in,
    // and the Mac's may not sign in other apps either. These are named in the "Where you are signed in" list.
    body.client = isMac() ? 'quarc-store-macos' : 'quarc-store-windows';
    const info = await storeNative()?.deviceInfo().catch(() => null);
    if (info?.model) body.device = info.model;
  }
  return body;
}

const useAuthStore = create((set, get) => ({
  user: cachedUser(),
  loading: true,

  async login(username, password) {
    const user = await api('/api/auth/login', { method: 'POST', body: await loginBody(username, password) });
    saveUser(user);
    set({ user, loading: false });
    await shareWithDevice(user);
    return user;
  },

  async register(username, password) {
    const user = await api('/api/auth/register', { method: 'POST', body: await loginBody(username, password) });
    saveUser(user);
    set({ user, loading: false });
    await shareWithDevice(user);
    return user;
  },

  async logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearUser();
    set({ user: null, loading: false });
    await signOutDevice();
  },

  /** Called when the server just re-issued our cookie (e.g. after "sign out everywhere else"). */
  async refreshDeviceSession() {
    const { user } = get();
    if (user) await shareWithDevice(user);
  },

  async checkSession() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(apiUrl('/api/auth/me'), { credentials: 'include', signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const user = await res.json();
        saveUser(user);
        set({ user, loading: false });
        await shareWithDevice(user);
      } else if (res.status === 401 || res.status === 403 || res.status === 404) {
        // Definitely signed out (expired, or revoked from another device).
        // Only a definite answer may sign the whole device out — a server
        // hiccup (5xx) must not log every Quarc app out.
        clearUser();
        set({ user: null, loading: false });
        await signOutDevice();
      } else {
        set({ user: get().user, loading: false });
      }
    } catch {
      // Offline: keep the last known user so the app stays usable.
      set({ user: get().user, loading: false });
    }
  },
}));

export default useAuthStore;
