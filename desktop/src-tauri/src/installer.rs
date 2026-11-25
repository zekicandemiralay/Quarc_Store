//! Downloading and running a Quarc app's installer, starting an app, and removing one.
//! (On a Mac the download is a disk image and the steps after it are in mac.rs.)
//!
//! The installers are the ones each app's release already ships (`...-setup.exe`, built by Tauri's
//! NSIS bundler). They install for the current user, so no administrator prompt is needed; the Store
//! runs them with `/S` (silent) and reports progress to the page through `installProgress` events,
//! the same events the Android Store sends, so the page's install buttons work unchanged.

use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use url::Url;

use crate::{registry, rules};

/// Installs in progress, by package name, each with its "cancel" flag.
#[derive(Default)]
pub struct Tasks(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress<'a> {
    package_name: &'a str,
    phase: &'a str,
    progress: f64,
    message: Option<String>,
}

fn emit(app: &AppHandle, package: &str, phase: &str, progress: f64, message: Option<String>) {
    let _ = app.emit(
        "installProgress",
        Progress {
            package_name: package,
            phase,
            progress,
            message,
        },
    );
}

enum Outcome {
    Done,
    Cancelled,
    /// The Store is updating itself: it has stepped aside and the installer restarts it.
    Restarting,
}

/// Runs one install to the end and reports how it went. Always removes the task when it is over.
pub async fn run(app: AppHandle, package: String, url: Url, file: String, cancel: Arc<AtomicBool>) {
    match flow(&app, &package, &url, &file, &cancel).await {
        Ok(Outcome::Done) => emit(&app, &package, "done", 100.0, None),
        Ok(Outcome::Cancelled) => emit(&app, &package, "cancelled", 0.0, None),
        Ok(Outcome::Restarting) => {}
        Err(message) => emit(&app, &package, "failed", 0.0, Some(message)),
    }
    app.state::<Tasks>().0.lock().unwrap().remove(&package);
}

async fn flow(app: &AppHandle, package: &str, url: &Url, file: &str, cancel: &AtomicBool) -> Result<Outcome, String> {
    let dir = std::env::temp_dir().join("QuarcStore").join(package);
    let _ = tokio::fs::remove_dir_all(&dir).await;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Couldn't prepare a download folder: {e}"))?;
    let path = dir.join(file);

    emit(app, package, "downloading", 0.0, None);
    if !download(app, package, url, &path, cancel).await? {
        let _ = tokio::fs::remove_dir_all(&dir).await;
        return Ok(Outcome::Cancelled);
    }

    emit(app, package, "installing", 100.0, None);
    if package == rules::SELF_PACKAGE {
        return self_update(app, &path).await;
    }

    let result = install_downloaded(&path, package, &dir).await;
    let _ = tokio::fs::remove_dir_all(&dir).await;
    result?;
    if registry::find(package).is_none() {
        return Err("The installer finished, but the app does not show up as installed".into());
    }
    Ok(Outcome::Done)
}

/// Windows: runs the downloaded installer silently.
#[cfg(not(target_os = "macos"))]
async fn install_downloaded(setup: &Path, _package: &str, _work: &Path) -> Result<(), String> {
    let setup = setup.to_path_buf();
    let code = tauri::async_runtime::spawn_blocking(move || run_hidden(&setup, &["/S"]))
        .await
        .map_err(|e| e.to_string())??;
    if code != 0 {
        return Err(format!("The installer stopped with code {code}"));
    }
    Ok(())
}

/// Mac: copies the app out of the downloaded disk image into Applications (mac.rs).
#[cfg(target_os = "macos")]
async fn install_downloaded(dmg: &Path, package: &str, work: &Path) -> Result<(), String> {
    let (dmg, package, work) = (dmg.to_path_buf(), package.to_string(), work.to_path_buf());
    tauri::async_runtime::spawn_blocking(move || crate::mac::install(&dmg, &package, &crate::mac::apps_dirs(), &work))
        .await
        .map_err(|e| e.to_string())?
        .map(|_| ())
}

/// Is the downloaded file what this computer installs from?
fn check_download(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if crate::mac::is_dmg(path) {
            Ok(())
        } else {
            Err("The downloaded file is not a Mac disk image".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Every Windows program starts with "MZ"; anything else is not an installer.
        let mut head = [0u8; 2];
        let is_program = std::fs::File::open(path)
            .and_then(|mut f| std::io::Read::read_exact(&mut f, &mut head))
            .is_ok()
            && &head == b"MZ";
        if is_program {
            Ok(())
        } else {
            Err("The downloaded file is not a Windows installer".into())
        }
    }
}

/// Downloads to `dest`. Returns false if it was cancelled.
async fn download(app: &AppHandle, package: &str, url: &Url, dest: &Path, cancel: &AtomicBool) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .user_agent("Quarc-Store-Desktop")
        .connect_timeout(Duration::from_secs(20))
        // GitHub hands release files over to its own download hosts; nowhere else.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let trusted = attempt.url().scheme() == "https"
                && attempt.url().host_str().is_some_and(rules::allowed_download_host);
            if trusted && attempt.previous().len() < 5 {
                attempt.follow()
            } else {
                attempt.error("The download was sent somewhere that is not GitHub")
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| format!("Couldn't start the download: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("The download failed (HTTP {})", response.status().as_u16()));
    }
    let total = response.content_length();
    let mut out = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Couldn't save the installer: {e}"))?;

    let (mut got, mut last_pct) = (0u64, -1i64);
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(out);
            let _ = tokio::fs::remove_file(dest).await;
            return Ok(false);
        }
        let next = tokio::time::timeout(Duration::from_secs(30), response.chunk())
            .await
            .map_err(|_| "The download stalled".to_string())?
            .map_err(|e| format!("The download was interrupted: {e}"))?;
        let Some(chunk) = next else { break };
        out.write_all(&chunk)
            .await
            .map_err(|e| format!("Couldn't save the installer: {e}"))?;
        got += chunk.len() as u64;
        if let Some(total) = total {
            let pct = (got * 100 / total.max(1)) as i64;
            if pct != last_pct {
                last_pct = pct;
                emit(app, package, "downloading", pct as f64, None);
            }
        }
    }
    out.flush().await.map_err(|e| format!("Couldn't save the installer: {e}"))?;
    drop(out);

    if total.is_some_and(|t| t != got) {
        return Err("The download was cut short".into());
    }
    check_download(dest)?;
    Ok(true)
}

/// Runs a program without a console window and waits for it. Returns its exit code.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn run_hidden(program: &Path, args: &[&str]) -> Result<i32, String> {
    let mut command = Command::new(program);
    command.args(args);
    hide_window(&mut command);
    let status = command
        .status()
        .map_err(|e| format!("Couldn't start {}: {e}", program.display()))?;
    Ok(status.code().unwrap_or(-1))
}

#[cfg(windows)]
fn hide_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn hide_window(_command: &mut Command) {}

/// The Store replacing itself: Windows cannot overwrite a running program, so a helper process
/// runs the installer after this one has quit, then starts the new Store.
#[cfg(windows)]
async fn self_update(app: &AppHandle, setup: &Path) -> Result<Outcome, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // `start /wait` because an installer is a window program: without it cmd would not wait for it.
    let line = format!(
        r#"/C start /wait "" "{}" /S && start "" "{}""#,
        setup.display(),
        exe.display()
    );
    Command::new("cmd")
        .raw_arg(line)
        .creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| format!("Couldn't start the update: {e}"))?;
    // Step aside so the installer can replace this program's files.
    tokio::time::sleep(Duration::from_millis(500)).await;
    app.exit(0);
    Ok(Outcome::Restarting)
}

/// The Store replacing itself on a Mac: the new copy is swapped in, then a helper opens it once this
/// one has quit (mac.rs).
#[cfg(target_os = "macos")]
async fn self_update(app: &AppHandle, dmg: &Path) -> Result<Outcome, String> {
    let dmg = dmg.to_path_buf();
    let work = dmg.parent().map(Path::to_path_buf).unwrap_or_else(std::env::temp_dir);
    tauri::async_runtime::spawn_blocking(move || crate::mac::self_update(&dmg, rules::SELF_PACKAGE, &work))
        .await
        .map_err(|e| e.to_string())??;
    tokio::time::sleep(Duration::from_millis(300)).await;
    app.exit(0);
    Ok(Outcome::Restarting)
}

#[cfg(not(any(windows, target_os = "macos")))]
async fn self_update(_app: &AppHandle, _setup: &Path) -> Result<Outcome, String> {
    Err("Updating the Store is only supported on Windows and Mac".into())
}

/// Development builds only: the self-update path with a local installer, so it can be tried before
/// the Store has a release with a Windows installer. Not compiled into release builds.
#[cfg(debug_assertions)]
pub async fn debug_self_update(app: &AppHandle, setup: &str) -> Result<(), String> {
    self_update(app, Path::new(setup)).await.map(|_| ())
}

/// Starts an installed app (Mac: the way Finder does).
#[cfg(target_os = "macos")]
pub fn launch(package: &str) -> Result<(), String> {
    let entry = registry::find(package).ok_or("That app is not installed")?;
    let bundle = entry.dir.ok_or("Couldn't find where the app is installed")?;
    crate::mac::open(&bundle)
}

/// Starts an installed app.
#[cfg(not(target_os = "macos"))]
pub fn launch(package: &str) -> Result<(), String> {
    let entry = registry::find(package).ok_or("That app is not installed")?;
    let dir = entry.dir.ok_or("Couldn't find where the app is installed")?;
    let binary = entry.main_binary.ok_or("Couldn't find the app's program")?;
    let program = dir.join(binary);
    if !program.is_file() {
        return Err("The app's program is missing".into());
    }
    let mut command = Command::new(program);
    command.current_dir(dir);
    detach(&mut command);
    command.spawn().map_err(|e| format!("Couldn't open the app: {e}"))?;
    Ok(())
}

#[cfg(windows)]
fn detach(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
}

#[cfg(not(any(windows, target_os = "macos")))]
fn detach(_command: &mut Command) {}

/// Removes an app from Applications (closing it first). Like on Windows, its data and settings are kept.
#[cfg(target_os = "macos")]
pub async fn uninstall(package: &str) -> Result<(), String> {
    if package == rules::SELF_PACKAGE {
        return Err("Quarc Store can't remove itself from here. Drag it from Applications to the Bin.".into());
    }
    let package = package.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let app = crate::mac::find(&crate::mac::apps_dirs(), &package).ok_or("That app is not installed")?;
        crate::mac::remove(&app)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Removes an installed app with its own uninstaller (`/S`: silent; the app's data is kept).
#[cfg(not(target_os = "macos"))]
pub async fn uninstall(package: &str) -> Result<(), String> {
    if package == rules::SELF_PACKAGE {
        return Err("Quarc Store can't remove itself from here. Use Windows Settings > Apps.".into());
    }
    let entry = registry::find(package).ok_or("That app is not installed")?;
    let program = entry
        .uninstall
        .filter(|p| p.is_file())
        .ok_or("Couldn't find the app's uninstaller")?;
    let code = tauri::async_runtime::spawn_blocking(move || run_hidden(&program, &["/S"]))
        .await
        .map_err(|e| e.to_string())??;
    if code != 0 {
        return Err(format!("The uninstaller stopped with code {code}"));
    }
    // NSIS uninstallers copy themselves aside and hand over, so the process above can end before
    // the files are gone. Wait until Windows no longer lists the app.
    for _ in 0..100 {
        if registry::find(package).is_none() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    Err("The uninstaller did not finish".into())
}

/// Opens an https address in the default browser.
pub fn open_url(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|_| "That is not a valid address".to_string())?;
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err("Only web addresses can be opened".into());
    }
    #[cfg(target_os = "macos")]
    {
        crate::mac::open_url(parsed.as_str())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut command = Command::new("rundll32");
        // One argument, never run through a shell: a "&" in the address is just part of it.
        command.arg("url.dll,FileProtocolHandler").arg(parsed.as_str());
        hide_window(&mut command);
        command.spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}
