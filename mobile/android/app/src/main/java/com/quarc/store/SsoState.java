package com.quarc.store;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The device's Quarc login, as held by Quarc Store, plus the "epoch" other
 * apps use to notice it changed.
 *
 * state: "none"       — the Store has never been signed in on this phone.
 *                       Apps keep whatever login they have of their own.
 *        "signed_in"  — apps adopt this account (Store is the primary source).
 *        "signed_out" — the user signed out of the Store: apps signed in
 *                       before that moment are signed out too.
 *
 * epoch: bumped (to at least the current time, so it never repeats across a
 * reinstall) on every sign-in, account switch or sign-out. A Quarc app only
 * acts when the epoch differs from the last one it applied — so a user who
 * deliberately signs in to an app on its own *after* signing out of the
 * Store keeps that login.
 */
final class SsoState {
    private SsoState() {}

    static final String NONE = "none";
    static final String SIGNED_IN = "signed_in";
    static final String SIGNED_OUT = "signed_out";

    private static final String PREFS = "quarc_sso_host";
    private static final String CLIENTS = "quarc_sso_clients";

    static final class Snapshot {
        final String state;
        final long epoch;
        final String user;
        final String origin;
        final String token;

        Snapshot(String state, long epoch, String user, String origin, String token) {
            this.state = state;
            this.epoch = epoch;
            this.user = user;
            this.origin = origin;
            this.token = token;
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static long nextEpoch(SharedPreferences p) {
        return Math.max(p.getLong("epoch", 0) + 1, System.currentTimeMillis());
    }

    private static String userId(String userJson) {
        if (userJson == null) return null;
        try {
            return new JSONObject(userJson).optString("id", null);
        } catch (Exception e) {
            return null;
        }
    }

    static synchronized long epoch(Context c) {
        SharedPreferences p = prefs(c);
        long e = p.getLong("epoch", 0);
        if (e == 0) {
            e = System.currentTimeMillis();
            p.edit().putLong("epoch", e).putString("state", NONE).commit();
        }
        return e;
    }

    /** @return true if this changed who is signed in (and so bumped the epoch). */
    static synchronized boolean signedIn(Context c, String origin, String token, String userJson) {
        epoch(c);
        SharedPreferences p = prefs(c);
        String prevState = p.getString("state", NONE);
        String prevUser = userId(p.getString("user", null));
        String newUser = userId(userJson);
        SharedPreferences.Editor ed = p.edit()
            .putString("state", SIGNED_IN)
            .putString("origin", origin)
            .putString("token", token)
            .putString("user", userJson);
        boolean changed = !SIGNED_IN.equals(prevState) || newUser == null || !newUser.equals(prevUser);
        if (changed) ed.putLong("epoch", nextEpoch(p));
        ed.commit();
        return changed;
    }

    /** @return true if the device was signed in and now isn't. */
    static synchronized boolean signedOut(Context c) {
        epoch(c);
        SharedPreferences p = prefs(c);
        if (!SIGNED_IN.equals(p.getString("state", NONE))) return false;
        p.edit()
            .putString("state", SIGNED_OUT)
            .remove("token")
            .remove("user")
            .putLong("epoch", nextEpoch(p))
            .commit();
        c.getApplicationContext().getSharedPreferences(CLIENTS, Context.MODE_PRIVATE).edit().clear().apply();
        return true;
    }

    static synchronized Snapshot snapshot(Context c) {
        long e = epoch(c);
        SharedPreferences p = prefs(c);
        return new Snapshot(p.getString("state", NONE), e, p.getString("user", null), p.getString("origin", null), p.getString("token", null));
    }

    static void putPublic(Snapshot s, Bundle out) {
        out.putString("state", s.state);
        out.putLong("epoch", s.epoch);
        if (SIGNED_IN.equals(s.state) && s.user != null) out.putString("user", s.user);
    }

    /**
     * Gets a fresh login for another app: a new server-side session that is a
     * child of the Store's own (so signing out of the Store ends it too).
     * Does network I/O — never call on the main thread.
     */
    static Bundle tokenFor(Context c, String pkg) {
        Snapshot s = snapshot(c);
        Bundle out = new Bundle();
        putPublic(s, out);
        out.putString("result", "ok");
        if (!SIGNED_IN.equals(s.state) || s.token == null || s.origin == null) return out;

        try {
            String body = new JSONObject().put("client", pkg).put("device", deviceLabel()).toString();
            Http.Response r = Http.postJson(s.origin + "/api/auth/sso/token", body, "Bearer " + s.token);
            if (r.code == 401) {
                // The Store's own session was revoked (signed out from another
                // device, password reset, ...): the whole phone is signed out.
                signedOut(c);
                Bundle gone = new Bundle();
                putPublic(snapshot(c), gone);
                gone.putString("result", "ok");
                return gone;
            }
            if (r.code != 200) return error(out, "mint_failed_http_" + r.code);
            JSONObject j = new JSONObject(r.body);
            // Signed out / switched account while we were waiting on the server?
            if (epoch(c) != s.epoch) return error(out, "state_changed");
            out.putString("token", j.getString("token"));
            out.putLong("expiresAt", j.optLong("expiresAt", 0));
            out.putString("user", j.getJSONObject("user").toString());
            recordClient(c, pkg);
            return out;
        } catch (Exception e) {
            return error(out, "network");
        }
    }

    private static Bundle error(Bundle out, String code) {
        out.putString("result", "error");
        out.putString("error", code);
        out.remove("token");
        return out;
    }

    static String deviceLabel() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String model = Build.MODEL == null ? "Android" : Build.MODEL;
        if (!maker.isEmpty() && !model.toLowerCase().startsWith(maker.toLowerCase())) {
            model = Character.toUpperCase(maker.charAt(0)) + maker.substring(1) + " " + model;
        }
        return model;
    }

    // ── Which apps on this phone use the Store login (for the Account page) ──

    private static void recordClient(Context c, String pkg) {
        c.getApplicationContext().getSharedPreferences(CLIENTS, Context.MODE_PRIVATE)
            .edit().putLong(pkg, System.currentTimeMillis()).apply();
    }

    static JSONArray clients(Context c) {
        JSONArray arr = new JSONArray();
        for (java.util.Map.Entry<String, ?> e : c.getApplicationContext().getSharedPreferences(CLIENTS, Context.MODE_PRIVATE).getAll().entrySet()) {
            try {
                arr.put(new JSONObject().put("packageName", e.getKey()).put("at", e.getValue()));
            } catch (Exception ignored) {
                // skip
            }
        }
        return arr;
    }
}
