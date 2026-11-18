package com.quarc.store;

import android.webkit.CookieManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS name: QuarcSsoHost. Hands the Store's own login to native storage so
 * SsoProvider can sign other apps in — even when the Store isn't open.
 *
 * The session cookie is httpOnly, so JS can't read it; CookieManager works
 * below the JS sandbox and can (same technique as Quarc Weather's widget).
 */
@CapacitorPlugin(name = "QuarcSsoHost")
public class SsoHostPlugin extends Plugin {

    /** After a login or a successful session check. */
    @PluginMethod
    public void syncSession(PluginCall call) {
        String origin = call.getString("serverOrigin");
        JSObject user = call.getObject("user");
        if (origin == null || !origin.startsWith("https://") || user == null) {
            call.reject("An https serverOrigin and the user are required");
            return;
        }
        String token = readCookie(origin, "token");
        JSObject r = new JSObject();
        if (token == null) {
            r.put("synced", false);
            call.resolve(r);
            return;
        }
        boolean changed = SsoState.signedIn(getContext(), origin, token, user.toString());
        r.put("synced", true);
        r.put("changed", changed);
        r.put("epoch", SsoState.epoch(getContext()));
        call.resolve(r);
    }

    /** Explicit sign-out, or the server said the Store's session is gone. */
    @PluginMethod
    public void signOut(PluginCall call) {
        JSObject r = new JSObject();
        r.put("changed", SsoState.signedOut(getContext()));
        r.put("epoch", SsoState.epoch(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        SsoState.Snapshot s = SsoState.snapshot(getContext());
        JSObject r = new JSObject();
        r.put("state", s.state);
        r.put("epoch", s.epoch);
        call.resolve(r);
    }

    /** Apps on this phone that have received the Store login. */
    @PluginMethod
    public void listClients(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("clients", new JSArray(SsoState.clients(getContext()).toString()));
        } catch (Exception e) {
            r.put("clients", new JSArray());
        }
        call.resolve(r);
    }

    private static String readCookie(String origin, String name) {
        String raw = CookieManager.getInstance().getCookie(origin);
        if (raw == null) return null;
        for (String part : raw.split(";")) {
            String p = part.trim();
            if (p.startsWith(name + "=")) {
                String v = p.substring(name.length() + 1);
                return v.isEmpty() ? null : v;
            }
        }
        return null;
    }
}
