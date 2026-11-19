# Quarc Store SSO kit

What a Quarc app needs so that, on Android, it signs in with Quarc Store's login. Already
applied to Music, Notes, Weather, Translate and Calendar.

Requirements for the app: Capacitor Android app, login through the shared quarc-auth
(`/api/auth/*`), a zustand `authStore` with `checkSession()`, and `lib/apiUrl.js` exporting
`API_BASE` — i.e. the standard Quarc app layout.

## 1. Copy the files

```bash
bash ../Quarc_Store/sso-kit/install.sh .        # from the app's repo root
```

Copies (re-run any time to refresh them):

- `android/QuarcSsoPlugin.java` → `mobile/android/app/src/main/java/<package>/` (package line rewritten)
- `web/storeSso.js` → `frontend/src/lib/storeSso.js`
- `web/StoreLoginButton.jsx` → `frontend/src/components/StoreLoginButton.jsx`
  (Android: "Continue as …"; web/desktop: "Sign in with your phone")
- `web/RequiredUpdateGate.jsx` → `frontend/src/components/RequiredUpdateGate.jsx`
- `web/StorePromo.jsx` → `frontend/src/components/StorePromo.jsx` — "Get Quarc Store".
  Mount `<StorePromo dialog />` next to `<App />` (a one-time card after each update, once per
  version), place `<StorePromo compact />` in the "update available" strip and `<StorePromo />` in
  the update section of Settings. It shows only on Android, only when the
  Store isn't installed, and only while the app's version is below its entry in
  `STORE_PROMO_UNTIL` (`web/storeSso.js`) — add a new app there with "first release + 10".

## 2. Wire it up (one time)

**`MainActivity.java`** — before `super.onCreate(...)`:

```java
registerPlugin(QuarcSsoPlugin.class);
```

**`AndroidManifest.xml`** — directly inside `<manifest>`:

```xml
<queries>
    <package android:name="com.quarc.store" />
</queries>
```

**`frontend/src/store/authStore.js`**:

```js
import { syncFromStore, watchStoreSession } from '../lib/storeSso';

// first line inside checkSession():
await syncFromStore();

// after the store is created, before `export default`:
watchStoreSession(() => useAuthStore.getState().checkSession());
```

**Login page** — above the form:

```jsx
import StoreLoginButton from '../components/StoreLoginButton';

<StoreLoginButton
  onSignedIn={async () => {
    await useAuthStore.getState().checkSession();
    navigate('/');
  }}
/>
```

**`frontend/src/main.jsx`** — next to `<App />` (the "Update required" screen):

```jsx
import RequiredUpdateGate from './components/RequiredUpdateGate';

<App />
<RequiredUpdateGate packageName="com.quarc.example" />
```

It asks the Store's server (same host, port 4006 — override with `VITE_STORE_URL`) for
the app's minimum supported version on launch and resume.

**Optional — updates through the Store.** In the Android branch of the app's update code:

```js
import { updateViaStore } from './storeSso';

updateViaStore().then((viaStore) => {
  if (!viaStore) window?.Capacitor?.Plugins?.Updater?.downloadUpdate({ url, version });
});
```

## 3. List it in the Store

Store → Admin → Catalog → **Add app**: id, name, GitHub repo, Android package name, web
URL. Leave *Can receive the Quarc Store login* on. After the next sync, the server has the
release APK's signing fingerprint and single sign-on is live for that app.

## 4. Test

1. Install the app's **release** build (debug builds have a different key — or add the
   debug fingerprint in the catalog: `node backend/scripts/apk-cert.js app-debug.apk`).
2. Sign in to the Store → open the app: signed in, no login screen.
3. Sign out of the Store → switch back to the app: signed out.
4. Sign in to the app with its own form → switch away and back: still signed in.
5. Uninstall the Store → the app's own login still works.

## Protocol reference

Provider `content://com.quarc.store.sso`, via `ContentResolver.call(uri, method, null, null)`:

| method | returns (Bundle) |
|---|---|
| `ping` | `protocol`, `result: "ok"` |
| `getState` | `result`, `state` (`none` \| `signed_in` \| `signed_out`), `epoch`, `user` (JSON) |
| `getToken` | the above + `token`, `expiresAt` (a fresh session for the caller only) |

`result` is `ok`, `denied` (+ `error`: `not_a_quarc_app`, `sso_disabled_for_app`,
`fingerprint_unknown`, `signature_mismatch`) or `error`.
