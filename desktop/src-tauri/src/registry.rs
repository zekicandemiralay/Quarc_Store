//! Which Quarc apps are installed on this computer. On a Mac: the Quarc apps in the Applications folders
//! (mac.rs). On Windows: read from Windows' list of installed programs, as follows.
//!
//! Every Quarc desktop app is installed by a Tauri (NSIS) installer, which registers the app under
//! `...\Uninstall\<product name>` with the publisher "Quarc", its version, its folder and the file it
//! starts from. The Store needs no list of its own: Windows already keeps one.

use std::path::PathBuf;

use crate::rules;

#[derive(Clone, Debug)]
pub struct Entry {
    /// "com.quarc.music" where the computer records it (a Mac app's identifier); None on Windows.
    pub id: Option<String>,
    /// "Quarc Music"
    pub display_name: String,
    /// "1.0.84"
    pub version: String,
    /// Folder the app is installed in (on a Mac: the .app itself).
    pub dir: Option<PathBuf>,
    /// "quarc-music.exe"
    pub main_binary: Option<String>,
    /// The app's own uninstall.exe (only ever a file called uninstall.exe).
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    pub uninstall: Option<PathBuf>,
}

#[cfg(windows)]
pub fn entries() -> Vec<Entry> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    const BASE: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    const BASE_32: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";

    let mut found = Vec::new();
    // Per-user installs (what the Quarc installers do) come first, so they win over any other copy.
    for (hive, path) in [(HKEY_CURRENT_USER, BASE), (HKEY_LOCAL_MACHINE, BASE), (HKEY_LOCAL_MACHINE, BASE_32)] {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for name in root.enum_keys().flatten() {
            let Ok(key) = root.open_subkey_with_flags(&name, KEY_READ) else {
                continue;
            };
            let publisher: String = key.get_value("Publisher").unwrap_or_default();
            if publisher != "Quarc" {
                continue;
            }
            let text = |value: &str| key.get_value::<String, _>(value).ok();
            let dir = text("InstallLocation")
                .map(|v| PathBuf::from(rules::unquote(&v)))
                .filter(|p| p.is_dir());
            let uninstall = text("UninstallString")
                .map(|v| PathBuf::from(rules::unquote(&v)))
                .filter(|p| p.file_name().is_some_and(|f| f.eq_ignore_ascii_case("uninstall.exe")));
            found.push(Entry {
                id: None,
                display_name: text("DisplayName").unwrap_or(name),
                version: text("DisplayVersion").unwrap_or_default(),
                dir: dir.or_else(|| uninstall.as_ref().and_then(|u| u.parent().map(PathBuf::from))),
                main_binary: text("MainBinaryName").filter(|b| rules::plain_file_name(b)),
                uninstall,
            });
        }
    }
    found
}

#[cfg(target_os = "macos")]
pub fn entries() -> Vec<Entry> {
    crate::mac::scan(&crate::mac::apps_dirs())
        .into_iter()
        .map(|b| Entry {
            id: Some(b.id),
            display_name: b.name,
            version: b.version,
            dir: Some(b.path),
            main_binary: b.executable,
            uninstall: None,
        })
        .collect()
}

/// Neither Windows nor a Mac: nothing is installed through this app. (Keeps the crate buildable elsewhere.)
#[cfg(not(any(windows, target_os = "macos")))]
pub fn entries() -> Vec<Entry> {
    Vec::new()
}

/// `com.quarc.music` is the Mac app with that identifier, or on Windows "quarc-music.exe" / "Quarc Music".
pub fn find_in(entries: &[Entry], package: &str) -> Option<Entry> {
    let suffix = rules::package_suffix(package)?;
    if let Some(entry) = entries.iter().find(|e| e.id.as_deref() == Some(package)) {
        return Some(entry.clone());
    }
    let binary = format!("quarc-{suffix}.exe");
    let name = format!("quarc {suffix}");
    entries
        .iter()
        .find(|e| {
            e.id.is_none()
                && (e.main_binary.as_deref().is_some_and(|b| b.eq_ignore_ascii_case(&binary))
                    || e.display_name.eq_ignore_ascii_case(&name))
        })
        .cloned()
}

pub fn find(package: &str) -> Option<Entry> {
    find_in(&entries(), package)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, binary: Option<&str>) -> Entry {
        Entry {
            id: None,
            display_name: name.into(),
            version: "1.0.0".into(),
            dir: None,
            main_binary: binary.map(String::from),
            uninstall: None,
        }
    }

    #[test]
    fn finds_by_main_binary_or_name() {
        let all = vec![entry("Quarc Music", Some("quarc-music.exe")), entry("Quarc Notes", None)];
        assert_eq!(find_in(&all, "com.quarc.music").unwrap().display_name, "Quarc Music");
        assert_eq!(find_in(&all, "com.quarc.notes").unwrap().display_name, "Quarc Notes");
        assert!(find_in(&all, "com.quarc.reader").is_none());
        assert!(find_in(&all, "com.evil.music").is_none());
    }

    #[test]
    fn a_mac_app_is_found_by_its_identifier_only() {
        let mut notes = entry("Quarc Notes", Some("quarc-notes"));
        notes.id = Some("com.quarc.notes".into());
        let mut impostor = entry("Quarc Music", Some("quarc-music.exe"));
        impostor.id = Some("com.example.music".into());
        let all = vec![impostor, notes];
        assert_eq!(find_in(&all, "com.quarc.notes").unwrap().display_name, "Quarc Notes");
        // Named like Quarc Music, but its identifier says it is something else.
        assert!(find_in(&all, "com.quarc.music").is_none());
    }
}
