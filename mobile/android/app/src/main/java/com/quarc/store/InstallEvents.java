package com.quarc.store;

/** Forwards install progress to the Store UI, if it's running. */
final class InstallEvents {
    private InstallEvents() {}

    /** phase: downloading | installing | confirm | done | failed | cancelled */
    static void emit(String pkg, String phase, int progress, String message) {
        StorePlugin plugin = StorePlugin.instance;
        if (plugin != null) plugin.emitInstall(pkg, phase, progress, message);
    }
}
