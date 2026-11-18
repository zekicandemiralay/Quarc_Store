package com.quarc.store;

import android.content.Context;
import android.content.SharedPreferences;

/** Background-update preferences, readable without the WebView. */
final class StoreSettings {
    private StoreSettings() {}

    private static final String PREFS = "quarc_store_settings";

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Check for updates in the background and notify. On by default. */
    static boolean checks(Context ctx) {
        return prefs(ctx).getBoolean("checks", true);
    }

    /** Install updates silently where Android allows it. Off by default. */
    static boolean autoInstall(Context ctx) {
        return prefs(ctx).getBoolean("autoInstall", false);
    }

    static void save(Context ctx, boolean checks, boolean autoInstall) {
        prefs(ctx).edit().putBoolean("checks", checks).putBoolean("autoInstall", checks && autoInstall).apply();
    }
}
