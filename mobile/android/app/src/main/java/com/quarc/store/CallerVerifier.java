package com.quarc.store;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Decides whether an app asking the SSO provider for a login is a genuine
 * Quarc app. Every Quarc app is signed with its own key, so instead of a
 * shared signature permission the caller's certificate must match one the
 * Store trusts for that package:
 *   - the fingerprint the Store server computed from the app's official
 *     release APK (or extra ones the admin added, e.g. for debug builds), or
 *   - the certificate of an APK the Store itself installed for that package.
 */
final class CallerVerifier {
    private CallerVerifier() {}

    static String check(Context ctx, String pkg) {
        if (pkg == null || pkg.isEmpty()) return "unknown_caller";
        JSONObject app = CatalogCache.find(ctx, pkg);
        if (app == null) return "not_a_quarc_app";
        if (!app.optBoolean("sso", false)) return "sso_disabled_for_app";

        Set<String> trusted = new HashSet<>(Certs.pinned(ctx, pkg));
        JSONArray fromServer = app.optJSONArray("certSha256");
        if (fromServer != null) {
            for (int i = 0; i < fromServer.length(); i++) trusted.add(fromServer.optString(i).toLowerCase());
        }
        if (trusted.isEmpty()) return "fingerprint_unknown";

        for (String cert : Certs.ofInstalled(ctx, pkg)) {
            if (trusted.contains(cert)) return null;
        }
        return "signature_mismatch";
    }
}
