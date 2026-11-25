# Building the Quarc Store desktop app (Windows and Mac)

The desktop app is a [Tauri 2](https://tauri.app) window around the Store's own pages
(`../frontend`: on Windows bundled into the program; on a Mac loaded from the Quarc server,
`src-tauri/tauri.macos.conf.json`). On top of the web Store it can install, update, open and
remove the Quarc desktop apps — see "The Windows app" and "The Mac app" in the main README for
how, and `src-tauri/src/` for the code:

| File | What |
|---|---|
| `main.rs` | the commands the page calls (`get_installed`, `install`, `uninstall`, `launch`, ...) |
| `installer.rs` | download, run an installer silently, start an app, remove an app, update the Store itself |
| `registry.rs` | finds installed Quarc apps in Windows' list of installed programs (on a Mac: via `mac.rs`) |
| `mac.rs` | the Mac side: Quarc apps in Applications, installing from a .dmg, open/quit/remove, the Store replacing itself |
| `rules.rs` | what may be downloaded and run (GitHub releases of this owner's Quarc apps only: `-setup.exe` on Windows, `.dmg` on a Mac); unit-tested |
| `build.rs` + `capabilities/` | the commands the page may call: `default.json` for the bundled Windows pages, `macos.json` for the server's page on a Mac |
| `../ci/` | the Mac CI test page and its runner (`run-harness.sh`) |
| `sso.rs` | the Store as the PC's Quarc login: keeps the Store's login and the "epoch" for the apps (see "Single sign-on on Windows" in the main README) |
| `../../sso-kit/desktop/quarc_sso_shared.rs` | the files the Store and the apps share; built into the Store from there |

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
together with the Android APK and the Mac disk images, and uploads them to one release.

## The Mac app

Built on a Mac (GitHub's `macos-latest` in CI): `npx tauri build --target aarch64-apple-darwin` (or
`x86_64-apple-darwin`) writes `src-tauri/target/<target>/release/bundle/dmg/Quarc Store_<version>_<arch>.dmg`,
ad-hoc signed (`signingIdentity: "-"` in `tauri.macos.conf.json`; no Apple developer account). The window
loads the server's Store page, so `VITE_API_URL` does not matter there (the bundled pages are still
needed to compile).

Without a Mac, the Mac code can still be type-checked on Windows (nothing is linked):
`rustup target add aarch64-apple-darwin`, then `cargo check --target aarch64-apple-darwin --all-targets` with
`CC_aarch64_apple_darwin`/`AR_aarch64_apple_darwin` pointing at a stand-in that just creates the files it is
asked for (some dependencies compile a little C or Objective-C in their build scripts).

The real tests run on GitHub's Mac machines with every push (`.github/workflows/test.yml`, `desktop-macos`).
Locally on a Mac: `cargo test`, and with a downloaded Quarc app .dmg
`QUARC_TEST_DMG=<file> cargo test -- --include-ignored installs_opens`.

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

`mac.rs` is built and its pure parts tested on every platform; the tests that need a real Mac are
`#[ignore]`d and run in CI (see "The Mac app").

## Icons

`logo.png` (1024 px) is the Store logo (`../logo.png`, an export of `QuarcNet/logos/store.svg`).
After changing it: `npx tauri icon logo.png -o src-tauri/icons`, then delete `src-tauri/icons/android`
and `src-tauri/icons/ios`.

## The version

`tauri.conf.json` says 1.1.0; a release build sets it from the tag. The installed version is what
the Store (and Windows' "Apps" list) shows, and what the catalog is compared against.
