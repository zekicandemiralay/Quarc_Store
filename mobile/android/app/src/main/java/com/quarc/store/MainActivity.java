package com.quarc.store;

import android.os.Bundle;
import android.webkit.CookieManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static volatile boolean foreground;

    /** Whether Android's install confirmation can be shown right away. */
    static boolean isForeground() {
        return foreground;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StorePlugin.class);
        registerPlugin(SsoHostPlugin.class);
        super.onCreate(savedInstanceState);
        // The Store's login is a cookie the server sets cross-origin (the page
        // runs at https://localhost). Explicit, rather than relying on defaults.
        CookieManager.getInstance().setAcceptThirdPartyCookies(getBridge().getWebView(), true);
        Notifications.ensureChannel(this);
        UpdateWorker.schedule(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        foreground = true;
    }

    @Override
    public void onPause() {
        foreground = false;
        super.onPause();
    }
}
