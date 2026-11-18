package com.quarc.store;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** JS name: QuarcStore — installed apps, install/update/uninstall/launch, background updates. */
@CapacitorPlugin(
    name = "QuarcStore",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class StorePlugin extends Plugin {

    static volatile StorePlugin instance;

    // One download at a time keeps "Update all" gentle on slow connections.
    private final ExecutorService installs = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, AtomicBoolean> active = new ConcurrentHashMap<>();

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    void emitInstall(String pkg, String phase, int progress, String message) {
        JSObject data = new JSObject();
        data.put("packageName", pkg);
        data.put("phase", phase);
        data.put("progress", progress);
        if (message != null) data.put("message", message);
        notifyListeners("installProgress", data, false);
    }

    static String installerOf(PackageManager pm, String pkg) {
        try {
            if (Build.VERSION.SDK_INT >= 30) return pm.getInstallSourceInfo(pkg).getInstallingPackageName();
            return legacyInstaller(pm, pkg);
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("deprecation")
    private static String legacyInstaller(PackageManager pm, String pkg) {
        return pm.getInstallerPackageName(pkg);
    }

    // ── Installed apps ───────────────────────────────────────────────────────

    @PluginMethod
    public void getInstalled(PluginCall call) {
        JSArray arr = call.getArray("packages", new JSArray());
        PackageManager pm = getContext().getPackageManager();
        String self = getContext().getPackageName();
        JSObject apps = new JSObject();
        try {
            List<String> pkgs = arr.toList();
            for (String pkg : pkgs) {
                JSObject o = new JSObject();
                try {
                    PackageInfo info = pm.getPackageInfo(pkg, 0);
                    String installer = installerOf(pm, pkg);
                    boolean byStore = self.equals(installer) || self.equals(pkg);
                    o.put("installed", true);
                    o.put("versionName", info.versionName);
                    o.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : legacyVersionCode(info));
                    o.put("byStore", byStore);
                    o.put("silentUpdates", byStore && Build.VERSION.SDK_INT >= 31);
                    o.put("updatedAt", info.lastUpdateTime);
                } catch (PackageManager.NameNotFoundException e) {
                    o.put("installed", false);
                }
                apps.put(pkg, o);
            }
        } catch (Exception e) {
            call.reject("Bad packages list", e);
            return;
        }
        JSObject r = new JSObject();
        r.put("apps", apps);
        call.resolve(r);
    }

    @SuppressWarnings("deprecation")
    private static long legacyVersionCode(PackageInfo info) {
        return info.versionCode;
    }

    // ── Install / update ─────────────────────────────────────────────────────

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't open settings", e);
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        String pkg = call.getString("packageName");
        String version = call.getString("version", "");
        String label = call.getString("label", pkg);
        if (url == null || pkg == null || !url.startsWith("https://")) {
            call.reject("An https url and a packageName are required");
            return;
        }
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("Quarc Store isn't allowed to install apps yet", "NEEDS_PERMISSION");
            return;
        }
        AtomicBoolean cancel = new AtomicBoolean(false);
        if (active.putIfAbsent(pkg, cancel) != null) {
            call.reject("Already installing this app", "BUSY");
            return;
        }
        installs.execute(() -> {
            try {
                ApkInstaller.downloadAndInstall(getContext(), url, pkg, version, label, true, cancel);
            } catch (ApkInstaller.Cancelled e) {
                ApkInstaller.cleanup(getContext(), pkg);
                InstallEvents.emit(pkg, "cancelled", 0, null);
            } catch (Exception e) {
                InstallEvents.emit(pkg, "failed", 0, e.getMessage());
            } finally {
                active.remove(pkg);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void cancelInstall(PluginCall call) {
        AtomicBoolean flag = active.get(call.getString("packageName", ""));
        if (flag != null) flag.set(true);
        call.resolve();
    }

    @PluginMethod
    public void uninstall(PluginCall call) {
        String pkg = call.getString("packageName");
        if (pkg == null) {
            call.reject("packageName required");
            return;
        }
        Intent i = new Intent(Intent.ACTION_DELETE, Uri.fromParts("package", pkg, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't start uninstall", e);
        }
    }

    @PluginMethod
    public void launch(PluginCall call) {
        String pkg = call.getString("packageName");
        Intent i = pkg == null ? null : getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) {
            call.reject("App not installed");
            return;
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("Only web links can be opened");
            return;
        }
        try {
            getContext().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception e) {
            call.reject("No browser available", e);
        }
    }

    // ── Catalog + background updates ─────────────────────────────────────────

    @PluginMethod
    public void setCatalog(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json required");
            return;
        }
        CatalogCache.save(getContext(), json, call.getString("origin"));
        call.resolve();
    }

    @PluginMethod
    public void getSettings(PluginCall call) {
        JSObject r = new JSObject();
        r.put("checks", StoreSettings.checks(getContext()));
        r.put("autoInstall", StoreSettings.autoInstall(getContext()));
        r.put("notificationsEnabled", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }

    @PluginMethod
    public void setBackgroundUpdates(PluginCall call) {
        StoreSettings.save(getContext(), Boolean.TRUE.equals(call.getBoolean("checks", true)), Boolean.TRUE.equals(call.getBoolean("autoInstall", false)));
        UpdateWorker.schedule(getContext());
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("model", SsoState.deviceLabel());
        r.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(r);
    }
}
