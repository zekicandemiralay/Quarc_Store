package com.quarc.store;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The slice of the Store catalog native code needs, kept on the device so the
 * SSO provider and the background update check work without the WebView:
 *
 * { apps: [{ id, name, packageName, sso, certSha256: [..], minVersion?, latest: { version, url } }] }
 *
 * Written by the JS app after every catalog load and by UpdateWorker.
 */
final class CatalogCache {
    private CatalogCache() {}

    private static final String PREFS = "quarc_catalog";

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void save(Context ctx, String slimJson, String origin) {
        SharedPreferences.Editor ed = prefs(ctx).edit().putString("json", slimJson);
        if (origin != null && origin.startsWith("https://")) ed.putString("origin", origin);
        ed.apply();
    }

    /** Server origin, e.g. https://quarcnet0.tail84500c.ts.net:4006 */
    static String origin(Context ctx) {
        return prefs(ctx).getString("origin", null);
    }

    static synchronized List<JSONObject> apps(Context ctx) {
        List<JSONObject> out = new ArrayList<>();
        String raw = prefs(ctx).getString("json", null);
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONObject(raw).optJSONArray("apps");
            if (arr == null) return out;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject a = arr.optJSONObject(i);
                if (a != null && a.optString("packageName", "").length() > 0) out.add(a);
            }
        } catch (JSONException ignored) {
            // corrupt cache: behave as empty until the next refresh
        }
        return out;
    }

    static JSONObject find(Context ctx, String pkg) {
        for (JSONObject a : apps(ctx)) if (pkg.equals(a.optString("packageName"))) return a;
        return null;
    }

    /** Full /api/store/catalog response → the slim shape above. */
    static JSONObject slim(JSONObject full) throws JSONException {
        JSONArray outApps = new JSONArray();
        JSONArray apps = full.optJSONArray("apps");
        if (apps != null) {
            for (int i = 0; i < apps.length(); i++) {
                JSONObject a = apps.getJSONObject(i);
                String pkg = a.optString("packageName", "");
                if (pkg.isEmpty() || "null".equals(pkg)) continue;
                JSONObject s = new JSONObject();
                s.put("id", a.optString("id"));
                s.put("name", a.optString("name"));
                s.put("packageName", pkg);
                s.put("sso", a.optBoolean("sso", false));
                s.put("certSha256", a.optJSONArray("certSha256") != null ? a.getJSONArray("certSha256") : new JSONArray());
                String minVersion = a.isNull("minVersion") ? "" : a.optString("minVersion", "");
                if (!minVersion.isEmpty()) s.put("minVersion", minVersion);
                JSONObject latest = a.optJSONObject("latest");
                JSONObject apk = latest == null ? null : latest.optJSONObject("assets") == null ? null : latest.getJSONObject("assets").optJSONObject("android");
                if (apk != null) {
                    s.put("latest", new JSONObject().put("version", latest.optString("version")).put("url", apk.optString("url")));
                }
                outApps.put(s);
            }
        }
        return new JSONObject().put("apps", outApps).put("syncedAt", full.optString("syncedAt", ""));
    }
}
