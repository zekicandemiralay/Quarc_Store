//! What this app is willing to download and run. Everything here is pure (no I/O),
//! so it is unit-tested below: this is the part that stops a wrong or hostile catalog
//! entry from turning "Install" into "run any program from anywhere".

use url::Url;

/// GitHub account whose releases may be installed. A catalog row pointing anywhere else is refused.
pub const OWNER: &str = "zekicandemiralay";

/// The Store's own package name (its desktop identifier, like every Quarc app's).
pub const SELF_PACKAGE: &str = "com.quarc.store";

/// `com.quarc.music` -> `Some("music")`. Only simple lower-case names are accepted.
pub fn package_suffix(package: &str) -> Option<&str> {
    let suffix = package.strip_prefix("com.quarc.")?;
    let ok = !suffix.is_empty()
        && suffix.len() <= 32
        && suffix.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
    ok.then_some(suffix)
}

/// A Windows installer from this owner's GitHub release:
/// `https://github.com/<OWNER>/Quarc_<App>/releases/download/<tag>/<name>-setup.exe`.
/// `suffix` is the app being installed (`music`): the release has to be that app's own repository.
/// Returns the URL and the file name to save it under.
pub fn installer_url(raw: &str, suffix: &str) -> Result<(Url, String), String> {
    let url = Url::parse(raw).map_err(|_| "That is not a valid download address".to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Installers are only downloaded from GitHub releases".into());
    }
    let parts: Vec<&str> = url.path_segments().map(|s| s.collect()).unwrap_or_default();
    // owner / repo / releases / download / tag / file
    if parts.len() != 6
        || !parts[0].eq_ignore_ascii_case(OWNER)
        || !parts[1].eq_ignore_ascii_case(&format!("Quarc_{suffix}"))
        || parts[2] != "releases"
        || parts[3] != "download"
    {
        return Err("This download is not a Quarc release".into());
    }
    let file = parts[5].to_string();
    let safe_name = file
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
    if !safe_name || !file.ends_with("-setup.exe") || file.contains("..") {
        return Err("This release has no Windows installer".into());
    }
    Ok((url, file))
}

/// Redirects while downloading may only stay on GitHub's own hosts.
pub fn allowed_download_host(host: &str) -> bool {
    host == "github.com" || host.ends_with(".githubusercontent.com")
}

/// The file an installed app starts from, as the uninstall entry's `MainBinaryName` gives it.
/// Only a plain file name is accepted, never a path.
pub fn plain_file_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['\\', '/', ':'])
        && name != "."
        && name != ".."
        && name.to_ascii_lowercase().ends_with(".exe")
}

/// `"C:\Users\x\AppData\Local\Quarc Music\uninstall.exe"` -> the path inside the quotes.
pub fn unquote(value: &str) -> &str {
    value.trim().trim_matches('"')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_names() {
        assert_eq!(package_suffix("com.quarc.music"), Some("music"));
        assert_eq!(package_suffix("com.quarc.store"), Some("store"));
        assert_eq!(package_suffix("com.quarc."), None);
        assert_eq!(package_suffix("com.other.music"), None);
        assert_eq!(package_suffix("com.quarc.Music"), None);
        assert_eq!(package_suffix("com.quarc.mu/sic"), None);
        assert_eq!(package_suffix("com.quarc.music.extra"), None);
    }

    #[test]
    fn accepts_quarc_release_installers() {
        let (url, file) = installer_url(
            "https://github.com/zekicandemiralay/Quarc_Music/releases/download/v1.0.84/Quarc.Music_1.0.84_x64-setup.exe",
            "music",
        )
        .unwrap();
        assert_eq!(file, "Quarc.Music_1.0.84_x64-setup.exe");
        assert_eq!(url.host_str(), Some("github.com"));
        assert!(installer_url(
            "https://github.com/ZekiCanDemiralay/Quarc_Reader/releases/download/v1.2.2/Quarc.Reader_1.2.2_x64-setup.exe",
            "reader"
        )
        .is_ok());
    }

    #[test]
    fn refuses_everything_else() {
        let bad = [
            "http://github.com/zekicandemiralay/Quarc_Music/releases/download/v1/a-setup.exe",
            "https://example.com/zekicandemiralay/Quarc_Music/releases/download/v1/a-setup.exe",
            "https://github.com.evil.com/zekicandemiralay/Quarc_Music/releases/download/v1/a-setup.exe",
            "https://github.com@evil.com/zekicandemiralay/Quarc_Music/releases/download/v1/a-setup.exe",
            "https://github.com:8443/zekicandemiralay/Quarc_Music/releases/download/v1/a-setup.exe",
            "https://github.com/someone/Quarc_Music/releases/download/v1/a-setup.exe",
            "https://github.com/zekicandemiralay/Other/releases/download/v1/a-setup.exe",
            "https://github.com/zekicandemiralay/Quarc_Music/archive/v1/a-setup.exe",
            "https://github.com/zekicandemiralay/Quarc_Music/releases/download/v1/a.msi",
            "https://github.com/zekicandemiralay/Quarc_Music/releases/download/v1/a-setup.exe?x=1",
            "https://github.com/zekicandemiralay/Quarc_Music/releases/download/v1/a%20b-setup.exe",
            "https://github.com/zekicandemiralay/Quarc_Music/releases/download/v1/..%5Cevil-setup.exe",
            "https://github.com/zekicandemiralay/Quarc_Music/releases/download/v1/x/a-setup.exe",
            "https://github.com/zekicandemiralay/Quarc_Notes/releases/download/v1/a-setup.exe",
            "file:///C:/Windows/System32/cmd.exe",
            "not a url",
        ];
        for raw in bad {
            assert!(installer_url(raw, "music").is_err(), "should refuse {raw}");
        }
    }

    #[test]
    fn redirect_hosts() {
        assert!(allowed_download_host("github.com"));
        assert!(allowed_download_host("objects.githubusercontent.com"));
        assert!(allowed_download_host("release-assets.githubusercontent.com"));
        assert!(!allowed_download_host("githubusercontent.com.evil.com"));
        assert!(!allowed_download_host("evil.com"));
    }

    #[test]
    fn executable_names_and_quotes() {
        assert!(plain_file_name("quarc-music.exe"));
        assert!(!plain_file_name("..\\x.exe"));
        assert!(!plain_file_name("C:\\x.exe"));
        assert!(!plain_file_name("a/b.exe"));
        assert!(!plain_file_name("quarc-music"));
        assert_eq!(unquote("\"C:\\a b\\uninstall.exe\""), "C:\\a b\\uninstall.exe");
        assert_eq!(unquote("  C:\\x.exe "), "C:\\x.exe");
    }
}
