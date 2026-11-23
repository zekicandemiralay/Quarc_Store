# Building the Quarc Store desktop app (Windows)

The desktop app is a [Tauri 2](https://tauri.app) window around the Store's own pages
(`../frontend`, bundled into the program, not loaded from a server). On top of the web
Store it can install, update, open and remove the Quarc desktop apps — see
"The Windows app" in the main README for how, and `src-tauri/src/` for the code:

| File | What |
|---|---|
| `main.rs` | the commands the page calls (`get_installed`, `install`, `uninstall`, `launch`, ...) |
| `installer.rs` | download, run an installer silently, start an app, remove an app, update the Store itself |
| `registry.rs` | finds installed Quarc apps in Windows' list of installed programs |
| `rules.rs` | what may be downloaded and run (GitHub releases of this owner's Quarc apps only); unit-tested |

## Prerequisites (one-time setup)

1. **Rust** — https://rustup.rs (restart your terminal afterwards)
2. **Node.js** — https://nodejs.org (v18 or newer)
3. **WebView2** — already installed on Windows 10/11

## Build the installer

```
cd frontend
npm install
set VITE_API_URL=https://quarcnet0.tail84500c.ts.net:4006   (PowerShell: $env:VITE_API_URL="...")
npm run build

cd ../desktop
npm install
npm run build
```

The installer is written to `src-tauri/target/release/bundle/nsis/Quarc Store_<version>_x64-setup.exe`.
`VITE_API_URL` matters: without it the bundled pages would call themselves instead of the server.

Pushing a `vX.Y.Z` tag does all of this in GitHub Actions (`.github/workflows/release.yml`),
together with the Android APK, and uploads both to one release.

## Try it without installing

```
cd desktop
npx tauri build --debug --no-bundle
src-tauri\target\debug\quarc-store.exe
```

A debug build also has a `debug_self_update` command (compiled out of release builds) that runs
the update-the-Store path with a local installer, for testing before a release exists.

## Tests

```
cd desktop/src-tauri
cargo test
```

## Icons

`logo.png` (1024 px) is the Store logo (`../logo.png`, an export of `QuarcNet/logos/store.svg`).
After changing it: `npx tauri icon logo.png -o src-tauri/icons`, then delete `src-tauri/icons/android`
and `src-tauri/icons/ios`.

## The version

`tauri.conf.json` says 1.1.0; a release build sets it from the tag. The installed version is what
the Store (and Windows' "Apps" list) shows, and what the catalog is compared against.
