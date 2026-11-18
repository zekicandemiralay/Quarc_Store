package com.quarc.store;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.Bundle;

/**
 * The door other Quarc apps knock on for a login: content://com.quarc.store.sso
 *
 * Methods (ContentResolver.call):
 *   "ping"     → { protocol, result: "ok" }                       (anyone)
 *   "getState" → { result, state, epoch, user? }                   (verified Quarc apps)
 *   "getToken" → { result, state, epoch, user?, token?, expiresAt? } (verified Quarc apps)
 *
 * The token is a brand-new session for the calling app only, minted by the
 * server as a child of the Store's session. Apps write it into their own
 * WebView cookie jar (see sso-kit/android/QuarcSsoPlugin.java).
 */
public class SsoProvider extends ContentProvider {
    static final int PROTOCOL = 1;

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Bundle call(String method, String arg, Bundle extras) {
        Context ctx = getContext();
        Bundle out = new Bundle();
        out.putInt("protocol", PROTOCOL);
        if (ctx == null) return fail(out, "not_ready");
        if ("ping".equals(method)) {
            out.putString("result", "ok");
            return out;
        }

        String caller = callingPackage(ctx);
        String denied = CallerVerifier.check(ctx, caller);
        if (denied != null) {
            out.putString("result", "denied");
            out.putString("error", denied);
            return out;
        }

        switch (method) {
            case "getState": {
                SsoState.putPublic(SsoState.snapshot(ctx), out);
                out.putString("result", "ok");
                return out;
            }
            case "getToken": {
                // Binder thread: network I/O is fine here.
                Bundle r = SsoState.tokenFor(ctx, caller);
                r.putInt("protocol", PROTOCOL);
                return r;
            }
            default:
                return fail(out, "unknown_method");
        }
    }

    private String callingPackage(Context ctx) {
        try {
            String pkg = getCallingPackage();
            if (pkg != null) return pkg;
        } catch (SecurityException ignored) {
            // fall through to the UID
        }
        String[] pkgs = ctx.getPackageManager().getPackagesForUid(Binder.getCallingUid());
        // A shared UID would make the caller ambiguous; refuse it.
        return pkgs != null && pkgs.length == 1 ? pkgs[0] : null;
    }

    private static Bundle fail(Bundle out, String error) {
        out.putString("result", "error");
        out.putString("error", error);
        return out;
    }

    // Not a data provider — only call() is supported.
    @Override public Cursor query(Uri uri, String[] p, String s, String[] a, String o) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
