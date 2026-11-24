# Quarc Store SSO kit

What a Quarc app needs so that, on Android and on Windows, it signs in with Quarc Store's login.
Already applied to Music, Notes, Weather, Translate, Calendar, Sport and Reader.

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

**Windows (the Tauri desktop app)** — `install.sh` copied `desktop/src-tauri/src/quarc_sso.rs` and
`quarc_sso_shared.rs`. Then, once:

`desktop/src-tauri/src/main.rs`:

```rust
mod quarc_sso;
mod quarc_sso_shared;

// on the builder:
.invoke_handler(tauri::generate_handler![
    quarc_sso::quarc_sso_peek,
    quarc_sso::quarc_sso_sync,
    quarc_sso::quarc_sso_open_store
])
```

`desktop/src-tauri/Cargo.toml`:

```toml
[dependencies]
serde_json = "1"

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61", features = ["Win32_Foundation", "Win32_Security_Cryptography"] }
```

`desktop/src-tauri/build.rs` — the window shows a page from the server, and Tauri only lets such a
page call app commands that are listed here *and* allowed in the capability:

```rust
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["quarc_sso_peek", "quarc_sso_sync", "quarc_sso_open_store"]),
        ),
    )
    .expect("failed to run tauri-build");
}
```

**Capability.** The three permissions `allow-quarc-sso-peek`, `allow-quarc-sso-sync` and
`allow-quarc-sso-open-store` must be granted to the server address the window shows, i.e. to a capability
with that address under `remote.urls`:

- if `capabilities/default.json` already has a `remote.urls` entry for the app (Music, Reader), add them
  to its `permissions`;
- if it has no `remote` section (Notes, Calendar, Weather, Translate, Sport), add a file
  `capabilities/quarc-sso.json` — and leave `default.json` alone:

```json
{
  "identifier": "quarc-sso",
  "windows": ["main"],
  "remote": { "urls": ["https://quarcnet0.tail84500c.ts.net:<the app's port>/*"] },
  "permissions": ["allow-quarc-sso-peek", "allow-quarc-sso-sync", "allow-quarc-sso-open-store"]
}
```

Without a matching `remote.urls` entry the page cannot call the commands at all (the app logs
"quarc_sso_peek not allowed" and never signs in): this was missing from five apps in their first Windows
release. If the app has commands of its own, list them in the manifest too and allow them, or they stop
working.

The web side (`storeSso.js`, `StoreLoginButton.jsx`, the `authStore` hooks) is the same code as on Android.

**An app that carries its own page** (Weather on Windows: `desktop/src-tauri/tauri.windows.conf.json` drops
the window's server URL and CI packs the built frontend into the app). Its window shows
`http://tauri.localhost`, not the server, so the origin check in `quarc_sso.rs` (`window_may_use`) also accepts
that host: nobody else can be shown there, and the login still only goes to the server it was made for (the
page's `serverOrigin` is its baked-in `VITE_API_URL`). Two traps that came with it:

- `tauri.windows.conf.json` **replaces** the whole `windows` list of `tauri.conf.json` on Windows. Window
  size, `maximized` and the like must be set *there*; changing only `tauri.conf.json` does nothing on Windows.
- Such an app must not keep a service worker (Weather's `public/sw.js` removes itself on `tauri.localhost`, and
  its page no longer registers one). A worker that answers from its cache serves the previous version's page
  after an update, whose script files are no longer inside the app (the app's page loader answers an unknown
  path with its index page, which the worker cached under the script's name), and the window stays blank.
  **Limit:** a worker that is ALREADY installed cannot be replaced by a newer one in this app (the browser's own
  background fetch of `/sw.js` is not served by the page loader: "unknown error when fetching the script"), and
  the new page code cannot run while the page is blank. On a PC that still has the old worker, it has to be
  cleared from outside: unregister it and delete its caches in the window (done by hand on the first PC,
  2026-11-24), or delete `%LOCALAPPDATA%com.quarc.weatherEBWebViewDefaultService Worker` while the app is
  closed. A fresh install, or a PC cleared once, never has the problem again.

**If the first sync fails** (network hiccup just as the app opens), `storeSso.js` retries it quietly on Windows —
after 1.5 s, 4 s and 9 s — and tells the app (the same callback as a window-focus re-check) once it was applied.
Android is unchanged.

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

## Protocol reference (Windows)

Folder `%LOCALAPPDATA%/Quarc/sso` (`sso-kit/desktop/quarc_sso_shared.rs`):

| file | holds |
|---|---|
| `state.json` | `state` (`none` | `signed_in` | `signed_out`), `epoch`, `user`, `origin`, `store.exe`/`store.version` (no secrets) |
| `session.dat` | the Store's own login `{token, origin}`, DPAPI-protected (the Store writes it, apps read it) |
| `applied/<package>` | the epoch that app last applied (the Store's "apps signed in here" list) |

The Store writes `session.dat` first and `state.json` after it; on sign-out `state.json` first and
`session.dat` removed after. An app that sees a new epoch asks `POST /api/auth/sso/token` for its own
login (the server only allows the sessions labelled `quarc-store` or `quarc-store-windows`).

## Protocol reference (Android)

Provider `content://com.quarc.store.sso`, via `ContentResolver.call(uri, method, null, null)`:

| method | returns (Bundle) |
|---|---|
| `ping` | `protocol`, `result: "ok"` |
| `getState` | `result`, `state` (`none` \| `signed_in` \| `signed_out`), `epoch`, `user` (JSON) |
| `getToken` | the above + `token`, `expiresAt` (a fresh session for the caller only) |

`result` is `ok`, `denied` (+ `error`: `not_a_quarc_app`, `sso_disabled_for_app`,
`fingerprint_unknown`, `signature_mismatch`) or `error`.
