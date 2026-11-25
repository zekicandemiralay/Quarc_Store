//! Quarc Store on a Mac: what is installed, installing from a .dmg, starting, quitting and removing apps,
//! and the Store replacing itself.
//!
//! Every Quarc app release ships a `.dmg` per Mac processor (`..._aarch64.dmg`, `..._x64.dmg`) holding one
//! `Quarc <App>.app`. Installing = mount the .dmg, copy the app into the Applications folder (beside the old
//! copy, then swapped in), unmount. An app counts as installed when an `.app` in /Applications or
//! ~/Applications carries the app's identifier (`com.quarc.notes`) in its Info.plist; its version is the
//! one in there too. No list of our own is kept: the Applications folder is the list.
//!
//! Written with the standard library and the Mac's own tools (hdiutil, ditto, open, ps, kill), so this file
//! also compiles, and its pure parts are unit-tested, on Windows and Linux. Only main.rs/installer.rs decide
//! to use it, on a Mac.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::fs;
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// One Quarc app found in an Applications folder.
#[derive(Clone, Debug, PartialEq)]
pub struct Bundle {
    /// `/Applications/Quarc Notes.app`
    pub path: PathBuf,
    /// `com.quarc.notes`
    pub id: String,
    /// `1.2.14`
    pub version: String,
    /// `Quarc Notes`
    pub name: String,
    /// `quarc-notes`: the program inside Contents/MacOS.
    pub executable: Option<String>,
}

// ── Info.plist ────────────────────────────────────────────────────────────────────────────────────

/// The `<string>` value right after `<key>name</key>` in an XML property list. Tauri writes Info.plist as
/// XML, flat at the top level for these keys, so this is all the parsing it needs.
pub fn plist_string(xml: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{key}</key>");
    let after = &xml[xml.find(&marker)? + marker.len()..];
    let after = after.trim_start();
    let rest = after.strip_prefix("<string>")?;
    let value = &rest[..rest.find("</string>")?];
    Some(
        value
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&")
            .trim()
            .to_string(),
    )
}

/// Info.plist as XML text. A binary plist (if anything ever rewrote it) is converted by the Mac's plutil.
fn read_plist_xml(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if bytes.starts_with(b"bplist") {
        let out = Command::new("/usr/bin/plutil")
            .args(["-convert", "xml1", "-o", "-"])
            .arg(path)
            .stderr(Stdio::null())
            .output()
            .ok()?;
        return out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned());
    }
    String::from_utf8(bytes).ok()
}

/// Reads an `.app` bundle's identity. None if it is not an app bundle or has no identifier.
pub fn read_bundle(path: &Path) -> Option<Bundle> {
    let xml = read_plist_xml(&path.join("Contents").join("Info.plist"))?;
    let id = plist_string(&xml, "CFBundleIdentifier")?;
    let dir_name = path.file_stem()?.to_string_lossy().into_owned();
    Some(Bundle {
        path: path.to_path_buf(),
        id,
        version: plist_string(&xml, "CFBundleShortVersionString")
            .or_else(|| plist_string(&xml, "CFBundleVersion"))
            .unwrap_or_default(),
        name: plist_string(&xml, "CFBundleName").filter(|n| !n.is_empty()).unwrap_or(dir_name),
        executable: plist_string(&xml, "CFBundleExecutable").filter(|e| plain_name(e)),
    })
}

/// A plain file name, never a path.
fn plain_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\', ':', '\0'])
}

// ── Where apps live ───────────────────────────────────────────────────────────────────────────────

/// /Applications first (where people put apps), then the per-user ~/Applications.
/// Debug builds can point `QUARC_STORE_APPS_DIR` at a test folder instead.
pub fn apps_dirs() -> Vec<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("QUARC_STORE_APPS_DIR").filter(|d| !d.is_empty()) {
        return vec![PathBuf::from(dir)];
    }
    let mut dirs = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME").filter(|h| !h.is_empty()) {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    dirs
}

/// Every Quarc app (identifier `com.quarc.*`) in these folders. The first folder wins if an app is in two.
pub fn scan(dirs: &[PathBuf]) -> Vec<Bundle> {
    let mut found: Vec<Bundle> = Vec::new();
    for dir in dirs {
        let Ok(entries) = fs::read_dir(dir) else { continue };
        let mut paths: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "app") && !hidden(p))
            .collect();
        paths.sort();
        for path in paths {
            if let Some(bundle) = read_bundle(&path) {
                if bundle.id.starts_with("com.quarc.") && !found.iter().any(|b| b.id == bundle.id) {
                    found.push(bundle);
                }
            }
        }
    }
    found
}

fn hidden(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))
}

pub fn find(dirs: &[PathBuf], package: &str) -> Option<Bundle> {
    scan(dirs).into_iter().find(|b| b.id == package)
}

// ── The downloaded file ───────────────────────────────────────────────────────────────────────────

/// A Mac disk image ends with a 512-byte trailer that starts with "koly". Anything else is not a .dmg.
pub fn is_dmg(path: &Path) -> bool {
    let check = || -> std::io::Result<bool> {
        let mut file = fs::File::open(path)?;
        if file.metadata()?.len() < 512 {
            return Ok(false);
        }
        file.seek(SeekFrom::End(-512))?;
        let mut magic = [0u8; 4];
        file.read_exact(&mut magic)?;
        Ok(&magic == b"koly")
    };
    check().unwrap_or(false)
}

/// A mounted .dmg, unmounted again when dropped (also when an install fails half-way).
struct Mounted {
    point: PathBuf,
}

impl Mounted {
    fn attach(dmg: &Path, point: &Path) -> Result<Self, String> {
        let _ = fs::remove_dir_all(point);
        fs::create_dir_all(point).map_err(|e| format!("Couldn't prepare a folder to open the download: {e}"))?;
        // -nobrowse: not shown in Finder; -noautoopen: no window; -readonly: nothing is written to it.
        let out = Command::new("/usr/bin/hdiutil")
            .args(["attach", "-nobrowse", "-noautoopen", "-readonly", "-mountpoint"])
            .arg(point)
            .arg(dmg)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Couldn't open the download (hdiutil): {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "Couldn't open the downloaded disk image: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(Mounted { point: point.to_path_buf() })
    }

    /// The one app inside with this identifier.
    fn app(&self, package: &str) -> Result<Bundle, String> {
        let entries = fs::read_dir(&self.point).map_err(|e| format!("Couldn't read the disk image: {e}"))?;
        entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "app"))
            .filter_map(|p| read_bundle(&p))
            .find(|b| b.id == package)
            .ok_or_else(|| "The download does not contain this app".to_string())
    }
}

impl Drop for Mounted {
    fn drop(&mut self) {
        for _ in 0..3 {
            let ok = Command::new("/usr/bin/hdiutil")
                .args(["detach", "-force"])
                .arg(&self.point)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success());
            if ok {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let _ = fs::remove_dir(&self.point);
    }
}

// ── Running apps ──────────────────────────────────────────────────────────────────────────────────

/// Process ids in `ps -axww -o pid=,command=` output whose program is inside this bundle.
pub fn pids_in_ps(ps: &str, bundle: &Path) -> Vec<u32> {
    let prefix = format!("{}/Contents/MacOS/", bundle.to_string_lossy().trim_end_matches('/'));
    ps.lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, command) = line.split_once(char::is_whitespace)?;
            command.trim_start().starts_with(&prefix).then(|| pid.parse().ok())?
        })
        .collect()
}

/// The running copies of the app in this bundle. A process shows its program's real path, so the bundle is
/// matched as given and with links resolved (/var/folders/... is really /private/var/folders/...).
pub fn running(bundle: &Path) -> Vec<u32> {
    let Ok(out) = Command::new("/bin/ps").args(["-axww", "-o", "pid=,command="]).output() else {
        return Vec::new();
    };
    let ps = String::from_utf8_lossy(&out.stdout);
    let me = std::process::id();
    let mut pids = pids_in_ps(&ps, bundle);
    if let Ok(real) = fs::canonicalize(bundle) {
        if real != bundle {
            pids.extend(pids_in_ps(&ps, &real));
        }
    }
    pids.sort_unstable();
    pids.dedup();
    pids.retain(|&p| p != me);
    pids
}

fn signal(pids: &[u32], sig: &str) {
    if pids.is_empty() {
        return;
    }
    let _ = Command::new("/bin/kill")
        .arg(sig)
        .args(pids.iter().map(u32::to_string))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Asks the app to quit (as the Mac does at log-out) and waits for it; forces it after a few seconds.
/// Returns whether it was running. Its data is already saved: the Quarc apps keep everything on disk as
/// they go, the same as when Windows' installer closes them for an update.
pub fn quit(bundle: &Path) -> bool {
    let pids = running(bundle);
    if pids.is_empty() {
        return false;
    }
    signal(&pids, "-TERM");
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(6) {
        if running(bundle).is_empty() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    signal(&running(bundle), "-KILL");
    std::thread::sleep(Duration::from_millis(300));
    true
}

/// Starts an app (or brings it forward if it is open) the way Finder does.
pub fn open(bundle: &Path) -> Result<(), String> {
    let status = Command::new("/usr/bin/open")
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Couldn't open the app: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("The Mac couldn't open the app".into())
    }
}

/// Opens a web address in the default browser.
pub fn open_url(url: &str) -> Result<(), String> {
    Command::new("/usr/bin/open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── Putting an app in place ───────────────────────────────────────────────────────────────────────

/// What a refused change to an app in the Applications folder means on a Mac, in words people can act on.
fn blocked(name: &str, e: &std::io::Error) -> String {
    if e.kind() == ErrorKind::PermissionDenied {
        format!(
            "Your Mac didn't let Quarc Store change {name}. Open System Settings > Privacy & Security > \
             App Management, turn on Quarc Store, then try again."
        )
    } else {
        format!("Couldn't change {name}: {e}")
    }
}

fn sibling(target: &Path, tag: &str) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.quarc-{tag}-{}", std::process::id()))
}

/// Copies `source` (an .app) to `target`, replacing what is there, so that `target` is never half-written:
/// the copy is made beside it and swapped in. Returns where the replaced app was moved (to delete later),
/// or None if nothing was there.
pub fn put_in_place(source: &Path, target: &Path, name: &str) -> Result<Option<PathBuf>, String> {
    let fresh = sibling(target, "new");
    let _ = fs::remove_dir_all(&fresh);
    // ditto copies an app the way the Mac does: symlinks, permissions, signatures and all.
    let out = Command::new("/usr/bin/ditto")
        .arg(source)
        .arg(&fresh)
        .output()
        .map_err(|e| format!("Couldn't copy the app (ditto): {e}"))?;
    if !out.status.success() {
        let _ = fs::remove_dir_all(&fresh);
        let message = String::from_utf8_lossy(&out.stderr);
        return Err(if message.contains("Permission denied") || message.contains("not permitted") {
            format!("Quarc Store can't write to {}.", target.parent().unwrap_or(target).display())
        } else {
            format!("Couldn't copy the app: {}", message.trim())
        });
    }
    // Downloaded by this app, not a browser, so the files carry no "downloaded from the internet" mark.
    // Cleared anyway, in case the disk image itself had one: these are the user's own Quarc apps.
    let _ = Command::new("/usr/bin/xattr")
        .args(["-dr", "com.apple.quarantine"])
        .arg(&fresh)
        .stderr(Stdio::null())
        .status();

    let old = if target.exists() {
        let aside = sibling(target, "old");
        let _ = fs::remove_dir_all(&aside);
        if let Err(e) = fs::rename(target, &aside) {
            let _ = fs::remove_dir_all(&fresh);
            return Err(blocked(name, &e));
        }
        Some(aside)
    } else {
        None
    };
    if let Err(e) = fs::rename(&fresh, target) {
        // Put the old one back rather than leave no app at all.
        if let Some(aside) = &old {
            let _ = fs::rename(aside, target);
        }
        let _ = fs::remove_dir_all(&fresh);
        return Err(blocked(name, &e));
    }
    Ok(old)
}

/// The folder a newly installed app goes to: /Applications if this user may write there (Mac admins can),
/// otherwise ~/Applications.
fn install_dir(dirs: &[PathBuf]) -> Result<PathBuf, String> {
    for dir in dirs {
        if fs::create_dir_all(dir).is_ok() && writable(dir) {
            return Ok(dir.clone());
        }
    }
    Err("There is no Applications folder Quarc Store can write to".into())
}

fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".quarc-store-write-test-{}", std::process::id()));
    let ok = fs::write(&probe, b"").is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

/// What `install` did.
#[derive(Debug)]
#[cfg_attr(not(test), allow(dead_code))]
pub struct Installed {
    pub bundle: PathBuf,
    pub was_running: bool,
}

/// Installs or updates `package` from a downloaded .dmg into one of `dirs` (an update replaces the app where
/// it is). An open copy of the app is closed first and opened again afterwards. `work` is a scratch folder.
pub fn install(dmg: &Path, package: &str, dirs: &[PathBuf], work: &Path) -> Result<Installed, String> {
    let mounted = Mounted::attach(dmg, &work.join("mnt"))?;
    let source = mounted.app(package)?;
    let existing = find(dirs, package);
    let target = match &existing {
        Some(b) => b.path.clone(),
        None => install_dir(dirs)?.join(source.path.file_name().ok_or("The app in the download has no name")?),
    };
    let was_running = existing.as_ref().is_some_and(|b| quit(&b.path));
    let placed = put_in_place(&source.path, &target, &source.name);
    drop(mounted);
    // Open again what was open: the new version, or the old one if the Mac refused the update.
    let reopen = || {
        if was_running {
            let _ = open(&target);
        }
    };
    match placed {
        Ok(old) => {
            if let Some(old) = old {
                let _ = fs::remove_dir_all(old);
            }
            reopen();
            Ok(Installed { bundle: target.clone(), was_running })
        }
        Err(e) => {
            reopen();
            Err(e)
        }
    }
}

/// Removes an app (closing it first). Like Windows' uninstallers, its data and settings are kept.
pub fn remove(bundle: &Bundle) -> Result<(), String> {
    quit(&bundle.path);
    let aside = sibling(&bundle.path, "removed");
    // Moved aside first (one step the Mac either allows or refuses), then deleted.
    fs::rename(&bundle.path, &aside).map_err(|e| blocked(&bundle.name, &e))?;
    let _ = fs::remove_dir_all(&aside);
    Ok(())
}

// ── The Store itself ──────────────────────────────────────────────────────────────────────────────

/// The .app this program runs from: `<bundle>/Contents/MacOS/<program>`.
pub fn own_bundle(exe: &Path) -> Option<PathBuf> {
    let bundle = exe.parent()?.parent()?.parent()?;
    let named = bundle.extension().is_some_and(|x| x == "app");
    let shaped = exe.parent()?.file_name()? == "MacOS" && exe.parent()?.parent()?.file_name()? == "Contents";
    (named && shaped).then(|| bundle.to_path_buf())
}

/// Places a Mac will not let an app replace itself: the opened disk image, or the read-only copy the Mac
/// runs a just-downloaded app from until it is moved to Applications ("App Translocation").
pub fn update_blocked_at(bundle: &Path) -> bool {
    let p = bundle.to_string_lossy();
    p.starts_with("/Volumes/") || p.contains("/AppTranslocation/")
}

/// The Store updating itself: the new copy is swapped in now (the running program keeps working from the
/// old files, which the Mac allows), and a small helper opens the new Store once this one has quit.
pub fn self_update(dmg: &Path, package: &str, work: &Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = own_bundle(&exe).ok_or("Quarc Store isn't running from an app bundle")?;
    if update_blocked_at(&bundle) {
        return Err("Move Quarc Store to your Applications folder, open it from there, then update.".into());
    }
    replace_and_reopen(dmg, package, work, &bundle, std::process::id())
}

/// Puts the app from `dmg` in place of `bundle` now, and opens it once process `pid` (the running copy) is gone.
pub fn replace_and_reopen(dmg: &Path, package: &str, work: &Path, bundle: &Path, pid: u32) -> Result<(), String> {
    let mounted = Mounted::attach(dmg, &work.join("mnt"))?;
    let source = mounted.app(package)?;
    let old = put_in_place(&source.path, bundle, &source.name)?;
    drop(mounted);

    // $1 = the running copy's pid, $2 = the replaced copy (deleted once it is gone), $3 = the app to open.
    const SCRIPT: &str = r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; [ -n "$2" ] && rm -rf "$2"; open "$3""#;
    let mut helper = Command::new("/bin/sh");
    helper
        .arg("-c")
        .arg(SCRIPT)
        .arg("quarc-store-update")
        .arg(pid.to_string())
        .arg(old.as_deref().unwrap_or(Path::new("")))
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        // Its own process group, so it outlives this program.
        use std::os::unix::process::CommandExt;
        helper.process_group(0);
    }
    helper.spawn().map_err(|e| format!("Couldn't start the update: {e}"))?;
    Ok(())
}

// ── This Mac ──────────────────────────────────────────────────────────────────────────────────────

/// "Zeki's MacBook Air" (the name in System Settings > General > Sharing).
pub fn computer_name() -> Option<String> {
    let out = Command::new("/usr/sbin/scutil").args(["--get", "ComputerName"]).output().ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !name.is_empty()).then_some(name)
}

/// "arm64" on Apple silicon (also when this program itself runs translated by Rosetta), else "x64".
pub fn hardware_arch() -> &'static str {
    let arm = Command::new("/usr/sbin/sysctl")
        .args(["-n", "hw.optional.arm64"])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).trim() == "1");
    if arm || cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>English</string>
	<key>CFBundleExecutable</key>
	<string>quarc-notes</string>
	<key>CFBundleIdentifier</key>
	<string>com.quarc.notes</string>
	<key>CFBundleName</key>
	<string>Quarc Notes</string>
	<key>CFBundleShortVersionString</key>
	<string>1.2.14</string>
	<key>CFBundleVersion</key>
	<string>1.2.14</string>
	<key>NSHumanReadableCopyright</key>
	<string>A &amp; B</string>
</dict>
</plist>"#;

    #[test]
    fn reads_info_plist_values() {
        assert_eq!(plist_string(PLIST, "CFBundleIdentifier").as_deref(), Some("com.quarc.notes"));
        assert_eq!(plist_string(PLIST, "CFBundleShortVersionString").as_deref(), Some("1.2.14"));
        assert_eq!(plist_string(PLIST, "CFBundleExecutable").as_deref(), Some("quarc-notes"));
        assert_eq!(plist_string(PLIST, "NSHumanReadableCopyright").as_deref(), Some("A & B"));
        assert_eq!(plist_string(PLIST, "Missing"), None);
        // A key whose value is not a string.
        assert_eq!(plist_string("<key>LSUIElement</key><true/>", "LSUIElement"), None);
    }

    fn fake_app(dir: &Path, file: &str, id: &str, version: &str) -> PathBuf {
        let app = dir.join(file);
        fs::create_dir_all(app.join("Contents").join("MacOS")).unwrap();
        let plist = PLIST.replace("com.quarc.notes", id).replace("1.2.14", version);
        fs::write(app.join("Contents").join("Info.plist"), plist).unwrap();
        app
    }

    #[test]
    fn finds_quarc_apps_by_identifier() {
        let root = std::env::temp_dir().join(format!("quarc-mac-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (system, user) = (root.join("Applications"), root.join("home").join("Applications"));
        fake_app(&system, "Quarc Notes.app", "com.quarc.notes", "1.2.14");
        fake_app(&system, "Other.app", "com.example.other", "9.9");
        fake_app(&system, ".Quarc Music.app.quarc-new-1.app", "com.quarc.music", "0.0.1");
        fake_app(&user, "Quarc Music.app", "com.quarc.music", "1.0.86");
        fake_app(&user, "Quarc Notes.app", "com.quarc.notes", "1.0.0"); // a second copy: /Applications wins
        fs::create_dir_all(system.join("Broken.app")).unwrap(); // no Info.plist

        let found = scan(&[system.clone(), user.clone()]);
        let ids: Vec<_> = found.iter().map(|b| (b.id.as_str(), b.version.as_str())).collect();
        assert_eq!(ids, vec![("com.quarc.notes", "1.2.14"), ("com.quarc.music", "1.0.86")]);
        let notes = find(&[system.clone(), user.clone()], "com.quarc.notes").unwrap();
        assert_eq!(notes.path, system.join("Quarc Notes.app"));
        assert_eq!(notes.executable.as_deref(), Some("quarc-notes"));
        assert!(find(&[system, user], "com.quarc.reader").is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recognises_a_disk_image() {
        let dir = std::env::temp_dir().join(format!("quarc-mac-dmg-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let mut image = vec![0u8; 4096];
        let at = image.len() - 512;
        image[at..at + 4].copy_from_slice(b"koly");
        fs::write(dir.join("a.dmg"), &image).unwrap();
        fs::write(dir.join("b.dmg"), vec![0u8; 4096]).unwrap();
        fs::write(dir.join("c.dmg"), b"koly").unwrap();
        assert!(is_dmg(&dir.join("a.dmg")));
        assert!(!is_dmg(&dir.join("b.dmg")));
        assert!(!is_dmg(&dir.join("c.dmg")));
        assert!(!is_dmg(&dir.join("missing.dmg")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn finds_the_running_copies_of_an_app() {
        let ps = "  101 /Applications/Quarc Notes.app/Contents/MacOS/quarc-notes\n\
                  202 /Applications/Quarc Notes.app/Contents/MacOS/quarc-notes --flag\n\
                  303 /Applications/Quarc Notes Old.app/Contents/MacOS/quarc-notes\n\
                  404 /System/Library/Frameworks/WebKit.framework/XPCServices/com.apple.WebKit.WebContent.xpc\n\
                  505 /Users/me/Applications/Quarc Notes.app/Contents/MacOS/quarc-notes\n\
                  bad line";
        assert_eq!(pids_in_ps(ps, Path::new("/Applications/Quarc Notes.app")), vec![101, 202]);
        assert_eq!(pids_in_ps(ps, Path::new("/Applications/Quarc Notes.app/")), vec![101, 202]);
        assert_eq!(pids_in_ps(ps, Path::new("/Applications/Quarc Music.app")), Vec::<u32>::new());
    }

    #[test]
    fn knows_its_own_bundle_and_where_it_cannot_update() {
        let exe = Path::new("/Applications/Quarc Store.app/Contents/MacOS/quarc-store");
        assert_eq!(own_bundle(exe), Some(PathBuf::from("/Applications/Quarc Store.app")));
        assert_eq!(own_bundle(Path::new("/usr/local/bin/quarc-store")), None);
        assert_eq!(own_bundle(Path::new("/tmp/target/debug/quarc-store")), None);
        assert!(update_blocked_at(Path::new("/Volumes/Quarc Store/Quarc Store.app")));
        assert!(update_blocked_at(Path::new(
            "/private/var/folders/x/T/AppTranslocation/ABC/d/Quarc Store.app"
        )));
        assert!(!update_blocked_at(Path::new("/Applications/Quarc Store.app")));
    }

    /// `ps` lines mentioning `needle`, for failure messages.
    #[cfg(target_os = "macos")]
    fn ps_matching(needle: &str) -> String {
        let out = Command::new("/bin/ps").args(["-axww", "-o", "pid=,command="]).output().unwrap();
        let lines: Vec<String> = String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter(|l| l.contains(needle))
            .map(str::to_string)
            .collect();
        format!("{lines:?}")
    }

    #[test]
    fn a_running_app_is_found_by_its_real_path_too() {
        // On a Mac /var is a link to /private/var; elsewhere this just finds nothing extra.
        let dir = std::env::temp_dir().join(format!("quarc-mac-real-path-{}", std::process::id()));
        fs::create_dir_all(dir.join("A.app")).unwrap();
        let real = fs::canonicalize(dir.join("A.app")).unwrap();
        let ps = format!("  77 {}/Contents/MacOS/a\n", real.display());
        assert_eq!(pids_in_ps(&ps, &real), vec![77]);
        let _ = fs::remove_dir_all(&dir);
    }

    /// The whole flow on a real Mac with a real Quarc release: install from the .dmg, find it, open it, update it
    /// while it is open (closed, replaced, opened again), remove it. Needs the network; run in CI on macOS with
    /// `cargo test -- --include-ignored` (QUARC_TEST_DMG = a downloaded Quarc Notes .dmg).
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn installs_opens_updates_and_removes_a_real_app() {
        let dmg = PathBuf::from(std::env::var("QUARC_TEST_DMG").expect("QUARC_TEST_DMG"));
        assert!(is_dmg(&dmg), "not a disk image: {}", dmg.display());
        let root = std::env::temp_dir().join(format!("quarc-mac-real-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let apps = root.join("Applications");
        fs::create_dir_all(&apps).unwrap();
        let dirs = vec![apps.clone()];
        let work = root.join("work");

        let done = install(&dmg, "com.quarc.notes", &dirs, &work).expect("install");
        assert_eq!(done.bundle, apps.join("Quarc Notes.app"));
        assert!(!done.was_running);
        let found = find(&dirs, "com.quarc.notes").expect("installed app is found");
        assert!(!found.version.is_empty() && found.version != "1.0.0", "version {}", found.version);
        let quarantine = Command::new("/usr/bin/xattr")
            .args(["-p", "com.apple.quarantine"])
            .arg(&found.path)
            .output()
            .unwrap();
        assert!(!quarantine.status.success(), "the installed app must not be quarantined");
        assert!(!work.join("mnt").exists() || fs::read_dir(work.join("mnt")).unwrap().next().is_none());

        open(&found.path).expect("open");
        let start = Instant::now();
        while running(&found.path).is_empty() && start.elapsed() < Duration::from_secs(20) {
            std::thread::sleep(Duration::from_millis(250));
        }
        assert!(!running(&found.path).is_empty(), "the app started; processes: {}", ps_matching("quarc-notes"));

        // Update while it is open.
        let again = install(&dmg, "com.quarc.notes", &dirs, &work).expect("update over the open app");
        assert!(again.was_running);
        assert_eq!(again.bundle, found.path);
        let start = Instant::now();
        while running(&found.path).is_empty() && start.elapsed() < Duration::from_secs(20) {
            std::thread::sleep(Duration::from_millis(250));
        }
        assert!(!running(&found.path).is_empty(), "the app was opened again after the update; processes: {}", ps_matching("quarc-notes"));
        let leftovers: Vec<_> = fs::read_dir(&apps).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(leftovers.len(), 1, "only the app is left: {leftovers:?}");

        remove(&find(&dirs, "com.quarc.notes").unwrap()).expect("remove");
        assert!(running(&found.path).is_empty(), "removing closes the app");
        assert!(find(&dirs, "com.quarc.notes").is_none());
        assert_eq!(fs::read_dir(&apps).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&root);
    }

    /// The Store replacing itself: the new copy is in place at once, and opened when the old one has quit.
    /// Run in CI on macOS with QUARC_TEST_STORE_DMG = the Store's own freshly built .dmg (and no other Store open).
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn the_store_replaces_itself_and_opens_the_new_copy_after_quitting() {
        let dmg = PathBuf::from(std::env::var("QUARC_TEST_STORE_DMG").expect("QUARC_TEST_STORE_DMG"));
        let root = std::env::temp_dir().join(format!("quarc-mac-self-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let apps = root.join("Applications");
        let current = fake_app(&apps, "Quarc Store.app", "com.quarc.store", "0.0.1");

        // Stands in for the running Store.
        let mut old_store = Command::new("/bin/sleep").arg("3").spawn().unwrap();
        replace_and_reopen(&dmg, "com.quarc.store", &root.join("work"), &current, old_store.id()).expect("update");
        let now = read_bundle(&current).expect("a Store is in place");
        assert_ne!(now.version, "0.0.1", "the new Store is in place right away");
        assert_eq!(now.id, "com.quarc.store");
        assert!(running(&current).is_empty(), "not opened while the old one still runs");

        old_store.wait().unwrap();
        let start = Instant::now();
        while running(&current).is_empty() && start.elapsed() < Duration::from_secs(30) {
            std::thread::sleep(Duration::from_millis(250));
        }
        assert!(!running(&current).is_empty(), "the new Store was opened after the old one quit; processes: {}", ps_matching("quarc-store"));
        quit(&current);
        let left: Vec<_> = fs::read_dir(&apps).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(left.len(), 1, "the replaced copy was deleted: {left:?}");
        let _ = fs::remove_dir_all(&root);
    }
}
