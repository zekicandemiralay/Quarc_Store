package com.quarc.store;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Every few hours: refresh the catalog, compare with what's installed,
 * auto-install what Android lets us install silently (if enabled), and
 * notify about the rest.
 */
public class UpdateWorker extends Worker {
    private static final String UNIQUE = "quarc-store-update-check";

    static final class Update {
        final String pkg;
        final String name;
        final String version;
        final String url;
        final boolean storeIsInstaller;
        /** The installed version is below the app's minimum supported version. */
        final boolean required;

        Update(String pkg, String name, String version, String url, boolean storeIsInstaller, boolean required) {
            this.pkg = pkg;
            this.name = name;
            this.version = version;
            this.url = url;
            this.storeIsInstaller = storeIsInstaller;
            this.required = required;
        }
    }

    public UpdateWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    /** Applies the current settings: (re)schedules or cancels the periodic check. */
    static void schedule(Context ctx) {
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!StoreSettings.checks(ctx)) {
            wm.cancelUniqueWork(UNIQUE);
            return;
        }
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(UpdateWorker.class, 6, TimeUnit.HOURS)
            .setConstraints(constraints)
            .build();
        wm.enqueueUniquePeriodicWork(UNIQUE, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        if (!StoreSettings.checks(ctx)) return Result.success();
        String origin = CatalogCache.origin(ctx);
        if (origin == null) return Result.success(); // Store never opened yet

        try {
            Http.Response r = Http.get(origin + "/api/store/catalog");
            if (r.code != 200) return Result.retry();
            CatalogCache.save(ctx, CatalogCache.slim(new JSONObject(r.body)).toString(), null);
        } catch (Exception e) {
            return Result.retry();
        }

        boolean auto = StoreSettings.autoInstall(ctx) && Build.VERSION.SDK_INT >= 31;
        List<Update> notify = new ArrayList<>();
        for (Update u : findUpdates(ctx)) {
            if (auto && u.storeIsInstaller) {
                try {
                    // Silent if Android allows it; otherwise the result
                    // receiver posts a "tap to finish" notification.
                    ApkInstaller.downloadAndInstall(ctx, u.url, u.pkg, u.version, u.name, false, null);
                    continue;
                } catch (Exception ignored) {
                    // fall back to just notifying
                }
            }
            notify.add(u);
        }
        Notifications.updatesAvailable(ctx, notify);
        return Result.success();
    }

    static List<Update> findUpdates(Context ctx) {
        List<Update> out = new ArrayList<>();
        PackageManager pm = ctx.getPackageManager();
        for (JSONObject app : CatalogCache.apps(ctx)) {
            JSONObject latest = app.optJSONObject("latest");
            if (latest == null) continue;
            String pkg = app.optString("packageName");
            String version = latest.optString("version");
            String url = latest.optString("url");
            if (version.isEmpty() || !url.startsWith("https://")) continue;
            try {
                PackageInfo info = pm.getPackageInfo(pkg, 0);
                if (Versions.compare(version, info.versionName) > 0) {
                    String min = app.optString("minVersion", "");
                    boolean required = !min.isEmpty() && Versions.compare(info.versionName, min) < 0;
                    boolean byStore = ctx.getPackageName().equals(StorePlugin.installerOf(pm, pkg));
                    out.add(new Update(pkg, app.optString("name", pkg), version, url, byStore, required));
                }
            } catch (PackageManager.NameNotFoundException ignored) {
                // not installed — nothing to update
            }
        }
        return out;
    }
}
