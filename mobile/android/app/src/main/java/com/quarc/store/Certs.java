package com.quarc.store;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;

import java.security.MessageDigest;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Signing-certificate fingerprints (lowercase hex SHA-256 of the certificate),
 * identical to what the Store server computes from release APKs and to
 * `apksigner verify --print-certs`.
 */
final class Certs {
    private Certs() {}

    private static final String PINS = "quarc_cert_pins";

    /** Fingerprints of an installed app; empty if it isn't installed. */
    static Set<String> ofInstalled(Context ctx, String pkg) {
        PackageManager pm = ctx.getPackageManager();
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo info = pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES);
                return fromSigningInfo(info.signingInfo);
            }
            return fromSignatures(legacySignatures(pm, pkg));
        } catch (PackageManager.NameNotFoundException e) {
            return new LinkedHashSet<>();
        }
    }

    /** Fingerprints of a downloaded, not yet installed APK. */
    static Set<String> ofArchive(Context ctx, String path) {
        PackageManager pm = ctx.getPackageManager();
        if (Build.VERSION.SDK_INT >= 28) {
            PackageInfo info = pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNING_CERTIFICATES);
            if (info != null && info.signingInfo != null) return fromSigningInfo(info.signingInfo);
        }
        @SuppressWarnings("deprecation")
        PackageInfo info = pm.getPackageArchiveInfo(path, PackageManager.GET_SIGNATURES);
        return info == null ? new LinkedHashSet<>() : fromSignatures(info.signatures);
    }

    @SuppressWarnings("deprecation")
    private static Signature[] legacySignatures(PackageManager pm, String pkg) throws PackageManager.NameNotFoundException {
        return pm.getPackageInfo(pkg, PackageManager.GET_SIGNATURES).signatures;
    }

    private static Set<String> fromSigningInfo(SigningInfo si) {
        if (si == null) return new LinkedHashSet<>();
        // History includes the original key if the app ever rotated keys.
        return fromSignatures(si.hasMultipleSigners() ? si.getApkContentsSigners() : si.getSigningCertificateHistory());
    }

    private static Set<String> fromSignatures(Signature[] sigs) {
        Set<String> out = new LinkedHashSet<>();
        if (sigs == null) return out;
        for (Signature s : sigs) out.add(sha256(s.toByteArray()));
        return out;
    }

    static String sha256(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder sb = new StringBuilder(d.length * 2);
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ── Pins ─────────────────────────────────────────────────────────────────
    // When the Store installs an app from its official release APK, it
    // remembers that APK's certificate: from then on, that app is trusted for
    // single sign-on even before the server has computed a fingerprint.

    static void pin(Context ctx, String pkg, Collection<String> certs) {
        if (certs.isEmpty()) return;
        SharedPreferences p = ctx.getSharedPreferences(PINS, Context.MODE_PRIVATE);
        Set<String> merged = new LinkedHashSet<>(pinned(ctx, pkg));
        merged.addAll(certs);
        p.edit().putString(pkg, String.join(",", merged)).apply();
    }

    static Set<String> pinned(Context ctx, String pkg) {
        String raw = ctx.getSharedPreferences(PINS, Context.MODE_PRIVATE).getString(pkg, "");
        Set<String> out = new LinkedHashSet<>();
        for (String s : raw.split(",")) if (!s.isEmpty()) out.add(s);
        return out;
    }
}
