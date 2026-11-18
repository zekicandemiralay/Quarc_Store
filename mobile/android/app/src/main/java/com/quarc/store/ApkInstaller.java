package com.quarc.store;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Build;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Download → verify → install, via a PackageInstaller session (not the old
 * "open the APK file" intent). That makes the Store the app's installer of
 * record, which on Android 12+ lets later updates of that app go through
 * without a confirmation prompt.
 */
final class ApkInstaller {
    private ApkInstaller() {}

    static final String ACTION_RESULT = "com.quarc.store.INSTALL_RESULT";

    static final class InstallException extends Exception {
        InstallException(String message) {
            super(message);
        }
    }

    static final class Cancelled extends Exception {
        Cancelled() {
            super("cancelled");
        }
    }

    /**
     * Blocking — run on a background thread. Progress and the final outcome
     * are reported through InstallEvents; the outcome arrives later, in
     * InstallResultReceiver, once Android has finished (or the user decided).
     *
     * @param interactive true when the user started this from the Store UI
     *                    (show Android's confirmation right away if needed);
     *                    false for background auto-updates (notify instead).
     */
    static void downloadAndInstall(Context ctx, String url, String pkg, String version, String label,
                                   boolean interactive, AtomicBoolean cancel) throws Exception {
        File apk = apkFile(ctx, pkg);
        InstallEvents.emit(pkg, "downloading", 0, null);
        download(url, apk, pkg, cancel);

        PackageManager pm = ctx.getPackageManager();
        PackageInfo info = pm.getPackageArchiveInfo(apk.getPath(), 0);
        if (info == null) throw fail(ctx, pkg, "The download isn't a valid Android app.");
        if (!pkg.equals(info.packageName)) throw fail(ctx, pkg, "The download is a different app (" + info.packageName + ").");

        Set<String> newCerts = Certs.ofArchive(ctx, apk.getPath());
        Set<String> installedCerts = Certs.ofInstalled(ctx, pkg);
        if (!installedCerts.isEmpty() && !newCerts.isEmpty() && Collections.disjoint(installedCerts, newCerts)) {
            throw fail(ctx, pkg, "This version is signed with a different key than the installed app. Uninstall the app first, then install it from the Store.");
        }
        // The official release's certificate: trusted for single sign-on from now on.
        Certs.pin(ctx, pkg, newCerts);

        InstallEvents.emit(pkg, "installing", 100, null);
        commit(ctx, apk, pkg, version, label, interactive);
    }

    private static InstallException fail(Context ctx, String pkg, String message) {
        cleanup(ctx, pkg);
        return new InstallException(message);
    }

    static File apkFile(Context ctx, String pkg) {
        File dir = new File(ctx.getCacheDir(), "apks");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, pkg + ".apk");
    }

    static void cleanup(Context ctx, String pkg) {
        //noinspection ResultOfMethodCallIgnored
        apkFile(ctx, pkg).delete();
    }

    private static void download(String url, File dest, String pkg, AtomicBoolean cancel) throws Exception {
        URL u = new URL(url);
        if (!"https".equals(u.getProtocol())) throw new IOException("Downloads must use HTTPS");
        HttpURLConnection con = null;
        // GitHub release assets redirect to a CDN host; follow manually so
        // every hop is checked to stay on HTTPS.
        for (int hops = 0; ; hops++) {
            con = (HttpURLConnection) u.openConnection();
            con.setInstanceFollowRedirects(false);
            con.setConnectTimeout(15000);
            con.setReadTimeout(30000);
            con.setRequestProperty("User-Agent", "QuarcStore-Android");
            int code = con.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = con.getHeaderField("Location");
                con.disconnect();
                if (location == null || hops >= 8) throw new IOException("Too many redirects");
                u = new URL(u, location);
                if (!"https".equals(u.getProtocol())) throw new IOException("Insecure redirect");
                continue;
            }
            if (code != 200) {
                con.disconnect();
                throw new IOException("Download failed (HTTP " + code + ")");
            }
            break;
        }

        long total = con.getContentLengthLong();
        long done = 0;
        int lastPct = -1;
        try (InputStream in = con.getInputStream(); OutputStream out = new FileOutputStream(dest)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) {
                if (cancel != null && cancel.get()) throw new Cancelled();
                out.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    int pct = (int) (done * 100 / total);
                    if (pct != lastPct) {
                        lastPct = pct;
                        InstallEvents.emit(pkg, "downloading", pct, null);
                    }
                }
            }
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            dest.delete();
            throw e;
        } finally {
            con.disconnect();
        }
    }

    private static void commit(Context ctx, File apk, String pkg, String version, String label, boolean interactive) throws IOException {
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(pkg);
        params.setSize(apk.length());
        params.setInstallReason(PackageManager.INSTALL_REASON_USER);
        if (Build.VERSION.SDK_INT >= 31) {
            // Silent when Android allows it (we're the installer of record and
            // the app targets a recent SDK); otherwise Android asks the user.
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }

        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("base.apk", 0, apk.length())) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                session.fsync(out);
            }
            Intent callback = new Intent(ctx, InstallResultReceiver.class)
                .setAction(ACTION_RESULT)
                .putExtra("pkg", pkg)
                .putExtra("label", label)
                .putExtra("version", version)
                .putExtra("interactive", interactive);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, sessionId, callback, flags);
            session.commit(pi.getIntentSender());
        } catch (IOException | RuntimeException e) {
            try {
                installer.abandonSession(sessionId);
            } catch (Exception ignored) {
                // already gone
            }
            throw e;
        }
    }
}
