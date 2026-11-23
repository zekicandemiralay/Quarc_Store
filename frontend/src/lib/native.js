// Thin accessors for what Quarc Store can do natively on the device it runs on:
//   Android: Capacitor plugins (see mobile/android/app/src/main/java/com/quarc/store/)
//   Windows: Tauri commands (see desktop/src-tauri/src/main.rs)
// In a browser every one of these returns null, so callers can use optional
// chaining instead of their own platform checks.

/** The Android app (Capacitor). */
export const isAndroid = () => !!window?.Capacitor?.isNativePlatform?.();
/** The Windows app (Tauri). */
export const isDesktop = () => !!(window?.__TAURI_INTERNALS__ || window?.__TAURI__);
/** Either app: this device can install, update and open Quarc apps. */
export const isNative = () => isAndroid() || isDesktop();

/** Which build of each app this device installs: the key in a release's `assets`. */
export const installPlatform = () => (isDesktop() ? 'windows' : 'android');

/** The file this device installs from a release (the APK, or the Windows installer). */
export const platformAsset = (release) => release?.assets?.[installPlatform()] ?? null;

const plugin = (name) => (isAndroid() ? window.Capacitor.Plugins?.[name] ?? null : null);

const tauri = () => window.__TAURI__;
const invoke = (command, args) => tauri().core.invoke(command, args);
const reject = () => Promise.reject(new Error('Not available on this device'));

// The Windows app, shaped like the Android "QuarcStore" plugin so the pages and stores don't
// care which one they are talking to. Android-only features are rejected or ignored.
const desktopStore = {
  getInstalled: ({ packages }) => invoke('get_installed', { packages }),
  install: ({ url, packageName }) => invoke('install', { url, packageName }),
  cancelInstall: ({ packageName }) => invoke('cancel_install', { packageName }),
  uninstall: ({ packageName }) => invoke('uninstall', { packageName }),
  launch: ({ packageName }) => invoke('launch', { packageName }),
  openUrl: ({ url }) => invoke('open_url', { url }),
  deviceInfo: () => invoke('device_info'),
  // Windows needs no install permission.
  canInstall: () => Promise.resolve({ allowed: true }),
  openInstallSettings: () => Promise.resolve(),
  // Progress events from the installer: resolves to a handle with remove().
  addListener: (event, callback) =>
    tauri()
      .event.listen(event, (e) => callback(e.payload))
      .then((unlisten) => ({ remove: unlisten })),
  // Background checks, notifications and the catalog slice are Android's background worker.
  setCatalog: () => Promise.resolve(),
  getSettings: reject,
  setBackgroundUpdates: () => Promise.resolve(),
  requestNotifications: () => Promise.resolve({ granted: false }),
};

/** Install / update / launch / uninstall apps (and, on Android, background update checks). */
export const storeNative = () => (isDesktop() ? desktopStore : plugin('QuarcStore'));
/** The device-wide login other Quarc apps receive (Android only). */
export const ssoHost = () => plugin('QuarcSsoHost');
/** @capacitor/app — deep links and resume events (Android only). */
export const appPlugin = () => plugin('App');

/** Opens a URL outside the app (system browser on Android and Windows, new tab on the web). */
export function openExternal(url) {
  if (!url) return;
  const native = storeNative();
  if (native) native.openUrl({ url }).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** Removes a listener handle whether it was returned directly or as a promise. */
export function removeListener(handle) {
  Promise.resolve(handle)
    .then((h) => h?.remove?.())
    .catch(() => {});
}
