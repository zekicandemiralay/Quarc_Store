//! The Store as the PC's Quarc login: when you sign in here, every Quarc desktop app on this PC is signed in too.
//!
//! The Windows counterpart of the Android Store's SsoState + SsoProvider (mobile/android/.../SsoState.java),
//! following the same rules; the files it writes are described in sso-kit/desktop/quarc_sso_shared.rs and read
//! by sso-kit/desktop/quarc_sso.rs inside each app.
//!
//!   - The Store's own login is a cookie in this window, which the page cannot read (it is httpOnly). The
//!     Store's native side reads it and keeps it (protected for this Windows user), so apps can get logins
//!     of their own later, even while this window is closed.
//!   - An app that sees the Store's state change asks the server for a login of its own with that login
//!     (POST /api/auth/sso/token: a child of the Store's session, so signing out of the Store, or revoking it
//!     anywhere, ends it too) and puts it in its own cookie jar.
//!   - The "epoch" changes on every sign-in, account switch or sign-out. Apps act only when it changes.

use std::sync::OnceLock;

use serde_json::{json, Value};
use tauri::{AppHandle, Url, Webview};
use tokio::sync::Mutex;

use crate::quarc_sso_shared as shared;

/// The one server the Store signs in to.
const SERVER_HOST: &str = "quarcnet0.tail84500c.ts.net";

/// One sign-in/sign-out at a time: they all rewrite the same files.
fn lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// A name for this PC in the "Where you are signed in" list.
pub fn device_label() -> String {
    let name = std::env::var("COMPUTERNAME").unwrap_or_default();
    if name.is_empty() {
        "Windows PC".to_string()
    } else {
        format!("{name} (Windows)")
    }
}

fn origin_allowed(origin: &Url) -> bool {
    if origin.scheme() != "https" {
        return false;
    }
    // Debug builds may talk to a test server.
    #[cfg(debug_assertions)]
    if std::env::var_os("QUARC_SSO_DIR").is_some() {
        return true;
    }
    origin.host_str() == Some(SERVER_HOST)
}

fn state_name(state: &Option<Value>) -> &str {
    state.as_ref().and_then(|s| s.get("state")).and_then(Value::as_str).unwrap_or("none")
}

fn epoch_of(state: &Option<Value>) -> i64 {
    state.as_ref().and_then(|s| s.get("epoch")).and_then(Value::as_i64).unwrap_or(0)
}

fn user_id(user: &Value) -> Option<&str> {
    user.get("id").and_then(Value::as_str)
}

fn store_block(app: &AppHandle) -> Value {
    json!({
        "exe": std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        "version": app.package_info().version.to_string(),
    })
}

fn next_epoch(previous: i64) -> i64 {
    (previous + 1).max(shared::now_ms())
}

/// Written every time the Store starts: where the Store is (so apps can open it) and that it exists at all.
pub fn announce(app: &AppHandle) {
    let mut state = shared::read_state().unwrap_or_else(|| json!({ "v": 1, "state": "none", "epoch": shared::now_ms() }));
    state["store"] = store_block(app);
    let _ = shared::write_state(&state);
}

/// After a sign-in or a successful session check in the Store's window: reads the Store's login (a cookie the
/// page can't see) and keeps it for the apps. Bumps the epoch if this changed who is signed in.
pub async fn sync_session(app: &AppHandle, webview: &Webview, origin: &str, user: Value) -> Result<Value, String> {
    let origin_url = Url::parse(origin).map_err(|_| "An https serverOrigin is required".to_string())?;
    if !origin_allowed(&origin_url) {
        return Err("That is not the Quarc server".into());
    }
    let new_user = user_id(&user).map(str::to_owned);
    let token = webview
        .cookies_for_url(origin_url)
        .map_err(|e| format!("cookie: {e}"))?
        .into_iter()
        .find(|c| c.name() == "token")
        .map(|c| c.value().to_string())
        .filter(|t| !t.is_empty());
    let Some(token) = token else {
        return Ok(json!({ "synced": false }));
    };
    let origin = origin.trim_end_matches('/').to_string();

    let _guard = lock().lock().await;
    let previous = shared::read_state();
    let previous_user = previous.as_ref().and_then(|s| s.get("user")).and_then(user_id).map(str::to_owned);
    let changed = state_name(&previous) != "signed_in" || new_user.is_none() || new_user != previous_user;
    let epoch = if changed { next_epoch(epoch_of(&previous)) } else { epoch_of(&previous) };

    // The login first, state second: an app that sees the new epoch always finds the login to use for it.
    if let Some(path) = shared::session_path() {
        shared::write_secret(&path, &json!({ "token": token, "origin": origin }))?;
    }
    shared::write_state(&json!({
        "v": 1,
        "state": "signed_in",
        "epoch": epoch,
        "user": user,
        "origin": origin,
        "store": store_block(app),
    }))?;
    Ok(json!({ "synced": true, "changed": changed, "epoch": epoch }))
}

/// Explicit sign-out in the Store, or the server said its session is gone. True if it was signed in.
pub async fn sign_out(app: &AppHandle) -> Value {
    let _guard = lock().lock().await;
    let mut state = shared::read_state();
    let changed = state_name(&state) == "signed_in";
    if changed {
        let mut next = state.take().unwrap_or_else(|| json!({ "v": 1 }));
        next["state"] = json!("signed_out");
        next["epoch"] = json!(next_epoch(next.get("epoch").and_then(Value::as_i64).unwrap_or(0)));
        next["store"] = store_block(app);
        if let Some(map) = next.as_object_mut() {
            map.remove("user");
        }
        // The state first, then the login: an app that sees "signed out" must not find a login to use.
        let _ = shared::write_state(&next);
        if let Some(path) = shared::session_path() {
            shared::remove(&path);
        }
    }
    json!({ "changed": changed, "epoch": epoch_of(&shared::read_state()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_quarc_server_over_https() {
        let ok = |s: &str| origin_allowed(&Url::parse(s).unwrap());
        assert!(ok("https://quarcnet0.tail84500c.ts.net:4006"));
        assert!(!ok("http://quarcnet0.tail84500c.ts.net:4006"));
        assert!(!ok("https://evil.example"));
        assert!(!ok("https://quarcnet0.tail84500c.ts.net.evil.example"));
        assert!(!ok("https://127.0.0.1:8943"));
    }
}

pub fn get_state() -> Value {
    let state = shared::read_state();
    json!({ "state": state_name(&state), "epoch": epoch_of(&state) })
}

/// Apps on this PC that have taken the Store's current login (the Account page lists them).
pub fn list_clients() -> Value {
    let state = shared::read_state();
    let current = state_name(&state) == "signed_in";
    let epoch = epoch_of(&state);
    let clients: Vec<Value> = shared::applied_apps()
        .into_iter()
        .filter(|(_, applied, _)| current && *applied == epoch)
        .map(|(package, _, at)| json!({ "packageName": package, "at": at }))
        .collect();
    json!({ "clients": clients })
}
