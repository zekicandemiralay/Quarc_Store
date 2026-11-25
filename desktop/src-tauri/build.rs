// The commands the Store's page calls (src/main.rs). Listed so Tauri lets a page call them only where a
// capability allows it: capabilities/default.json (the pages bundled into the app, on Windows) and
// capabilities/macos.json (on a Mac the page comes from the Quarc server).
const COMMANDS: &[&str] = &[
    "get_installed",
    "install",
    "cancel_install",
    "uninstall",
    "launch",
    "open_url",
    "device_info",
    "sso_sync_session",
    "sso_sign_out",
    "sso_get_state",
    "sso_list_clients",
    "take_launch_url",
    "debug_self_update",
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
