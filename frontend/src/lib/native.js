// Thin accessors for Quarc Store's native Android plugins (see
// mobile/android/app/src/main/java/com/quarc/store/). On the web every one
// of these returns null, so callers can use optional chaining instead of
// their own platform checks.

export const isNative = () => !!window?.Capacitor?.isNativePlatform?.();

const plugin = (name) => (isNative() ? window.Capacitor.Plugins?.[name] ?? null : null);

/** Install / update / launch / uninstall apps, background update checks. */
export const storeNative = () => plugin('QuarcStore');
/** The device-wide login other Quarc apps receive. */
export const ssoHost = () => plugin('QuarcSsoHost');
/** @capacitor/app — deep links and resume events. */
export const appPlugin = () => plugin('App');

/** Opens a URL outside the app (system browser on Android, new tab on the web). */
export function openExternal(url) {
  if (!url) return;
  const native = storeNative();
  if (native) native.openUrl({ url }).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** Removes a listener handle whether Capacitor returned it directly or as a promise. */
export function removeListener(handle) {
  Promise.resolve(handle)
    .then((h) => h?.remove?.())
    .catch(() => {});
}
