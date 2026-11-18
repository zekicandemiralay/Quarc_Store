# Quarc Store

One place to get every Quarc app — and one login for all of them.

- **Every Quarc app in one list**: install, see what's new, update (one by one or all at
  once), open, uninstall. Background update checks with notifications, and optional
  automatic updates.
- **One login on your phone**: sign in to Quarc Store once and every Quarc app on that
  phone is signed in — no separate logins. Sign out of the Store and they're all signed
  out, even apps you had signed in to on their own before installing the Store.
- **Account control for the whole suite**: see every device and app you're signed in on,
  sign one out, or sign out everywhere. Admins manage all Quarc users from the Store.
- **Optional by design**: every app keeps its own login screen and works without the
  Store, on Android and on every other platform. When the Store *is* installed, it is the
  primary source: its login wins.
- **Web version** at `https://quarcnet0.tail84500c.ts.net:4006` — the same catalog with
  downloads for every platform the apps ship on, and your account settings.
- **Android apps only**: the catalog lists apps that have an Android build (Music, Notes,
  Calendar, Weather, Translate, and the Store itself); an app needs an Android package
  name to be added.

```
Quarc_Store/
├── auth/       quarc-auth — the shared login service for the whole suite
├── backend/    catalog service — mirrors each app's GitHub releases, computes APK signing fingerprints
├── frontend/   the Store UI (web + bundled into the Android app)
├── mobile/     the Android app (Capacitor) — installer, update worker, single sign-on provider
└── sso-kit/    the small piece every Quarc app carries to receive the Store's login
```

---

## Part 1 — Server setup

### Requirements

Same as every Quarc app: Docker + Docker Compose, Tailscale with HTTPS certificates, and the
shared Docker network `quarcnet-shared` (created automatically by `deploy.sh`).

### First install

```bash
git clone https://github.com/zekicandemiralay/Quarc_Store.git
cd Quarc_Store
cp .env.example .env                 # optional: GITHUB_TOKEN
```

**The shared login now lives here** (it used to be in the Quarc_Notes repo, which no
longer contains it). If your server still runs the old one, switch it over — no data
migration needed, the new one reuses the same Docker volume (`auth_auth_data`):

```bash
cp ~/Quarc_Notes/auth/.env auth/.env      # same JWT_SECRET → nobody gets logged out
                                          # (.env isn't tracked by git, so it's still there
                                          #  even after pulling Quarc_Notes)
docker stop quarc-auth && docker rm quarc-auth   # the old v1 container; its data volume stays
bash deploy.sh all                               # quarc-auth v2 + the Store
```

On a brand-new server instead: `cp auth/.env.example auth/.env`, set a long random
`JWT_SECRET` (the **same** one every Quarc app's `.env` uses), then `bash deploy.sh all`.

Then:

```bash
bash check.sh
```

The Store is at **`https://quarcnet0.tail84500c.ts.net:4006`** (Music 4000, Notes 4001,
Weather 4002, Translate 4003, Calendar 4005).

Within a minute the backend has fetched every app's releases from GitHub and computed each
Android app's signing fingerprint — that's what turns on single sign-on for that app
(`check.sh` reports it; Store → Admin → Catalog shows it per app).

### Updating

```bash
bash deploy.sh          # the Store
bash deploy.sh auth     # the shared login
bash deploy.sh all      # both
```

### Backup / restore

**Automatic, every night:** quarc-auth and the Store back up their databases into
`backups/nightly_YYYY-MM-DD/` (`auth.db` + `store.db`), after 02:00 UTC — or right away
if the server missed a night — keeping 14 days (`BACKUP_HOUR_UTC`, `BACKUP_KEEP_DAYS`).
Nothing to set up; `check.sh` shows the newest one. They sit on the same disk as the
server, so copy `backups/` somewhere else now and then.

```bash
bash backup.sh                              # a manual backup, including the .env files
bash restore.sh <backup-dir>                # from backup.sh …
bash restore.sh backups/nightly_2026-11-20  # … or from a nightly one (uses the current auth/.env)
```

`auth.db` is the most important file in the whole suite now — include this in your
server migration (see `../MIGRATION.md`).

### Configuration

| File | Variable | Default | Purpose |
|---|---|---|---|
| `auth/.env` | `JWT_SECRET` | — | **Must equal every Quarc app's `JWT_SECRET`** |
| `auth/.env` | `SESSION_LIFETIME_DAYS` | `365` | Login lifetime (sliding) |
| `auth/.env` | `ALLOW_REGISTRATION` | `true` | `false` = only admins create accounts |
| `auth/.env` | `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / random | First admin, created only if none exists |
| `.env` | `GITHUB_TOKEN` | empty | Optional; raises GitHub API limits |
| `.env` | `SYNC_INTERVAL_MINUTES` | `15` | How often releases are checked |
| `.env` | `PUBLIC_HOST`, `GITHUB_OWNER` | your values | Used only to seed the catalog on first start |

---

## Part 2 — Releasing the Android app

Same flow as your other apps: push a tag, GitHub Actions builds and signs the APK.

**One-time setup** (needs a JDK — Android Studio's bundled `jbr/bin/keytool` works):

```bash
keytool -genkeypair -v -keystore quarc-store.keystore -alias quarc-store \
        -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 quarc-store.keystore      # → GitHub secret KEYSTORE_BASE64
```

Add repository secrets `KEYSTORE_BASE64` and `KEYSTORE_PASSWORD` (store and key password
the same, like the other apps). **Keep the keystore safe** — Android only accepts updates
signed with the same key.

**Logo / icons:** the source is `logo.svg` (also `frontend/public/icon.svg`); `logo.png`,
`frontend/public/logo.png` and `mobile/resources/icon.png` are renders of it. After changing
it, regenerate the Android launcher icons and splash screens with `cd mobile && npm run icons`.

**Each release:**

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The Store lists itself in its own catalog, so installed Stores pick up new versions.

**The other apps** need one new release each to carry the single sign-on piece (already
added in their working trees — see "What changed in the other apps" below). Until an app
is updated, it simply keeps using its own login.

---

## Part 3 — How it works

### Single sign-on on Android

Each Android app runs its own WebView with its own private cookie jar, so a login in one
app was never visible to another. The Store bridges that:

```
 ┌──────────────── Quarc Store (com.quarc.store) ────────────────┐
 │  You sign in → quarc-auth issues the Store's session (client  │
 │  "quarc-store"). The native side keeps it, plus an "epoch"     │
 │  that changes on every sign-in / account switch / sign-out.    │
 │                                                                │
 │  SsoProvider  content://com.quarc.store.sso                    │
 │   1. who's calling? → package name from Android (unforgeable)  │
 │   2. is it a Quarc app whose signing certificate matches the   │
 │      official release's? (fingerprint from the Store server,   │
 │      or pinned when the Store installed it) — else refused     │
 │   3. getToken → POST /api/auth/sso/token: a NEW session just   │
 │      for that app, a child of the Store's session              │
 └───────────────────────────────▲────────────────────────────────┘
                                 │ on launch and on every resume
 ┌──────────── Quarc Music / Notes / … (QuarcSsoPlugin) ─────────┐
 │  epoch changed? → signed in: write the token into this app's  │
 │                   WebView cookie jar (same httpOnly cookie a   │
 │                   normal login sets)                           │
 │                 → signed out: clear the cookie                 │
 │  then the app's normal checkSession() runs, unchanged          │
 └────────────────────────────────────────────────────────────────┘
```

Rules that follow from this:

| Situation | Result |
|---|---|
| Store not installed / never signed in | Apps use their own login, exactly as before |
| Sign in to the Store | Every Quarc app on the phone is signed in (as that account) next time it's opened or brought back |
| Switch account in the Store | Apps switch too |
| Sign out of the Store | Every app on the phone is signed out — including apps that were signed in on their own before the Store was installed (server-side too: the sessions it gave out are children of the Store's) |
| Uninstall the Store | Apps go back to being fully independent, keeping whatever login they have |
| Sign in to an app on its own *after* signing out of the Store | Respected — kept until the Store changes again |
| Sign out of one app | Only that app; its login screen offers **"Continue as ⟨you⟩"** for one tap back in |
| "Sign out everywhere" / admin resets your password | Every device and app is signed out |
| Offline | Apps keep working with what they have; the Store is never required to open an app |

On the **web** nothing extra is needed: all Quarc apps share one host, so the browser
already shares the login cookie between them.

### Sessions and revocation (quarc-auth v2)

Every login now has a server-side session (`sid` in the JWT). Apps still verify JWTs
locally, so a revoked session is signed out the next time the app checks its session —
which every app does on launch (and, with the SSO kit, on resume). Details:
[auth/README.md](auth/README.md).

### Installs and updates

The Android app downloads the APK straight from the GitHub release, checks it's the right
package and signed by the same key as the installed app, then installs it with Android's
`PackageInstaller`. That makes the Store the app's *installer of record*: on Android 12+,
later updates of that app install without a confirmation prompt (the first install/update
through the Store still asks once). A background job checks every ~6 hours and notifies
you; with "Install updates automatically" on, it installs what Android allows silently.

When the Store is installed, an app's own "Update available → Install" button opens the
Store on that app instead of downloading the APK itself.

### Required updates

When a server change breaks older versions of an app, set **Minimum supported version** in
Store → Admin → Catalog → (app). Then:

- the Store marks that update **Required** (in the list, on the Updates tab, and in its
  notification);
- the app itself — Android and desktop, with or without the Store — shows a blocking
  "Update required" screen with an Update button on its next launch or resume.

It fails open: if the app can't reach the Store's server (and never heard of a minimum),
it just runs. The minimum can't be set higher than the latest release, so nobody can be
locked out with nothing to update to. Clear the field to lift the requirement.

### Sign in with your phone (web and desktop)

Every Quarc app's web and desktop login page — and the Store's own web page — has
**Sign in with your phone**: type your username, the page shows a 2-digit number, and
Quarc Store on your phone asks you to type that number. Get it right and the computer is
signed in (its own session, listed under "Where you are signed in"); get it wrong once and
the request is blocked. Requests expire after 2 minutes. Only Quarc Store on the Android
phone can approve, and it checks for requests while it's open — so open the Store after
clicking "Send to my phone".

---

## What changed in the other apps

Applied to **Music, Notes, Weather, Translate, Calendar** (working trees only — nothing
committed). Per app:

| File | Change |
|---|---|
| `mobile/android/.../QuarcSsoPlugin.java` | new — from `sso-kit/` |
| `mobile/android/.../MainActivity.java` | `registerPlugin(QuarcSsoPlugin.class)` |
| `mobile/android/app/src/main/AndroidManifest.xml` | `<queries>` for `com.quarc.store` |
| `frontend/src/lib/storeSso.js` | new — from `sso-kit/` |
| `frontend/src/components/StoreLoginButton.jsx` | new — "Continue as … / Sign in with Quarc Store" |
| `frontend/src/store/authStore.js` | `syncFromStore()` before the session check; re-check on resume |
| `frontend/src/components/RequiredUpdateGate.jsx` + `main.jsx` | new — the "Update required" screen, mounted next to `<App />` |
| `frontend/src/components/StorePromo.jsx` + the update banner and the update section in Settings (Music: the update dialog) | new — "Get Quarc Store" with a download link, on Android when the Store isn't installed, during each app's first 10 releases after the Store launched (cut-offs in `STORE_PROMO_UNTIL`, `sso-kit/web/storeSso.js`); stops by itself afterwards |
| Login page | the Store button above the form: on Android "Continue as …" (nothing if the Store isn't installed); on web/desktop "Sign in with your phone" |
| `.github/workflows/desktop-release.yml` (Notes, Weather, Translate, Calendar) | Android `versionCode` = MAJOR×10000+MINOR×100+PATCH like Music's — the old "remove the dots" formula went backwards (1.0.10 → 1010, 1.1.0 → 110) and Android refuses such updates |
| update code (`lib/updateCheck.js`; Music: `Layout.jsx`, `Sidebar.jsx`) | Android updates go through the Store when it's installed |

Also: the old `auth/` folder was removed from **Quarc_Notes**, and every README /
`.env.example` / `check.sh` that pointed there now points to `Quarc_Store/auth`. Quarc
Music's admin page now creates users through quarc-auth's admin endpoint (v2 also adds the
user-list, password-reset and user-search endpoints Music's admin and friends features call).

To add the kit to a future app: [sso-kit/README.md](sso-kit/README.md).

---

## Security notes

- The SSO provider is exported (it has to be: each Quarc app has its own signing key, so
  Android's signature permissions can't be shared). Every call is checked against the
  caller's **signing certificate**; an app with the right package name but a different key
  gets nothing.
- Debug builds are signed with a debug key, so they won't get the Store login unless you
  add that fingerprint in Admin → Catalog → (app) → *Extra signing fingerprints*
  (`node backend/scripts/apk-cert.js app-debug.apk` prints it).
- Apps trust the Store by package name (`com.quarc.store`): Android guarantees only one app
  can hold that name and the provider authority at a time.
- The Store's own token is kept in its private app storage with backups disabled.
- Tokens handed to apps are separate sessions, so any one can be revoked on its own.
