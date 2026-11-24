#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Quarc Store for Windows.
//!
//! The window shows the same Store pages as the Android app, bundled into this program. What the
//! Android Store does through its native plugin (what is installed, install, update, open, remove)
//! is done here by the commands below, which the page reaches through `frontend/src/lib/native.js`.

mod installer;
// Single sign-on: the files the Store and the apps share. One copy, used here and carried by every app.
#[path = "../../../sso-kit/desktop/quarc_sso_shared.rs"]
mod quarc_sso_shared;
mod registry;
mod rules;
mod sso;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, Webview};

/// A `quarcstore://` link the Store was started with (another Quarc app opening it: sign in, an app's page).
/// The page picks it up once it is ready.
#[derive(Default)]
struct LaunchUrl(Mutex<Option<String>>);

fn launch_url_in<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|a| {
        a.starts_with("quarcstore://")
            && a.len() < 200
            && a.bytes().all(|b| b.is_ascii_alphanumeric() || b"/:?=&._-%".contains(&b))
    })
}

/// What the page asks for: `{ apps: { "<package>": { installed, versionName, ... } } }`.
#[tauri::command]
fn get_installed(app: AppHandle, packages: Vec<String>) -> Value {
    let entries = registry::entries();
    let mut apps = serde_json::Map::new();
    for package in packages {
        if rules::package_suffix(&package).is_none() {
            continue;
        }
        let info = match registry::find_in(&entries, &package) {
            Some(entry) => json!({
                "installed": true,
                "versionName": entry.version,
                "versionCode": 0,
                "byStore": false,
                "silentUpdates": false,
            }),
            // Running from a development build: the Store itself is not "installed", but it is here.
            None if package == rules::SELF_PACKAGE => json!({
                "installed": true,
                "versionName": app.package_info().version.to_string(),
                "versionCode": 0,
                "byStore": false,
                "silentUpdates": false,
            }),
            None => json!({ "installed": false }),
        };
        apps.insert(package, info);
    }
    json!({ "apps": apps })
}

/// Starts downloading and installing; progress arrives as `installProgress` events.
#[tauri::command]
fn install(
    app: AppHandle,
    tasks: State<'_, installer::Tasks>,
    url: String,
    package_name: String,
) -> Result<(), String> {
    let suffix = rules::package_suffix(&package_name).ok_or("That is not a Quarc app")?;
    let (url, file) = rules::installer_url(&url, suffix)?;

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = tasks.0.lock().unwrap();
        if running.contains_key(&package_name) {
            return Err("That app is already being installed".into());
        }
        running.insert(package_name.clone(), cancel.clone());
    }
    tauri::async_runtime::spawn(installer::run(app, package_name, url, file, cancel));
    Ok(())
}

#[tauri::command]
fn cancel_install(tasks: State<'_, installer::Tasks>, package_name: String) {
    if let Some(flag) = tasks.0.lock().unwrap().get(&package_name) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[tauri::command]
async fn uninstall(package_name: String) -> Result<(), String> {
    installer::uninstall(&package_name).await
}

#[tauri::command]
fn launch(package_name: String) -> Result<(), String> {
    installer::launch(&package_name)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    installer::open_url(&url)
}

/// Development builds only (compiled out of release builds): see installer::debug_self_update.
#[cfg(debug_assertions)]
#[tauri::command]
async fn debug_self_update(app: AppHandle, path: String) -> Result<(), String> {
    installer::debug_self_update(&app, &path).await
}

/// A name for this PC in the "Where you are signed in" list.
#[tauri::command]
fn device_info() -> Value {
    json!({ "model": sso::device_label() })
}

// ── Single sign-on: the Store as this PC's Quarc login (see sso.rs) ──────────────────────────────

/// After a sign-in or session check: share the Store's login with the Quarc apps on this PC.
#[tauri::command]
async fn sso_sync_session(app: AppHandle, webview: Webview, origin: String, user: Value) -> Result<Value, String> {
    sso::sync_session(&app, &webview, &origin, user).await
}

#[tauri::command]
async fn sso_sign_out(app: AppHandle) -> Value {
    sso::sign_out(&app).await
}

#[tauri::command]
fn sso_get_state() -> Value {
    sso::get_state()
}

#[tauri::command]
fn sso_list_clients() -> Value {
    sso::list_clients()
}

/// The `quarcstore://` link the Store was started with, once.
#[tauri::command]
fn take_launch_url(state: State<'_, LaunchUrl>) -> Option<String> {
    state.0.lock().unwrap().take()
}

fn main() {
    let builder = tauri::Builder::default()
        // First, as the plugin requires: opening the Store again brings the open window forward.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(url) = launch_url_in(args) {
                let _ = app.emit("store-open-url", url);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(installer::Tasks::default())
        .manage(LaunchUrl::default())
        .setup(|app| {
            let handle = app.handle().clone();
            // Tell the apps where the Store is, and pick up a link we were started with.
            sso::announce(&handle);
            if let Some(url) = launch_url_in(std::env::args()) {
                *app.state::<LaunchUrl>().0.lock().unwrap() = Some(url);
            }
            Ok(())
        });

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_installed,
        install,
        cancel_install,
        uninstall,
        launch,
        open_url,
        device_info,
        sso_sync_session,
        sso_sign_out,
        sso_get_state,
        sso_list_clients,
        take_launch_url,
        debug_self_update
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_installed,
        install,
        cancel_install,
        uninstall,
        launch,
        open_url,
        device_info,
        sso_sync_session,
        sso_sign_out,
        sso_get_state,
        sso_list_clients,
        take_launch_url
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Quarc Store");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_up_a_quarcstore_link_and_nothing_else() {
        let url = "quarcstore://login?return=com.quarc.music";
        assert_eq!(launch_url_in(args(&["quarc-store.exe", url])).as_deref(), Some(url));
        // The first argument is the program itself.
        assert_eq!(launch_url_in(args(&[url])), None);
        assert_eq!(launch_url_in(args(&["quarc-store.exe"])), None);
        assert_eq!(launch_url_in(args(&["quarc-store.exe", "https://evil.example"])), None);
        assert_eq!(launch_url_in(args(&["quarc-store.exe", "quarcstore://app/x y"])), None);
        assert_eq!(launch_url_in(args(&["quarc-store.exe", "quarcstore://login?return=a\"b"])), None);
    }
}
