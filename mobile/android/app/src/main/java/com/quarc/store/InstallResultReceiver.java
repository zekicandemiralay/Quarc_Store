package com.quarc.store;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

/** Android's verdict on an install session started by ApkInstaller. */
public class InstallResultReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!ApkInstaller.ACTION_RESULT.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String pkg = intent.getStringExtra("pkg");
        String label = intent.getStringExtra("label");
        String version = intent.getStringExtra("version");
        boolean interactive = intent.getBooleanExtra("interactive", false);
        if (pkg == null) return;

        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                Intent confirm = confirmIntent(intent);
                if (confirm == null) {
                    InstallEvents.emit(pkg, "failed", 0, "Android didn't provide a confirmation screen");
                    return;
                }
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                InstallEvents.emit(pkg, "confirm", 100, null);
                if (interactive && MainActivity.isForeground()) {
                    try {
                        ctx.startActivity(confirm);
                        return;
                    } catch (Exception ignored) {
                        // fall back to a notification
                    }
                }
                Notifications.needsConfirmation(ctx, pkg, label, confirm);
                return;
            }
            case PackageInstaller.STATUS_SUCCESS:
                ApkInstaller.cleanup(ctx, pkg);
                Notifications.clearConfirmation(ctx, pkg);
                InstallEvents.emit(pkg, "done", 100, null);
                if (!interactive) Notifications.updated(ctx, pkg, label, version);
                return;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                ApkInstaller.cleanup(ctx, pkg);
                Notifications.clearConfirmation(ctx, pkg);
                InstallEvents.emit(pkg, "cancelled", 0, null);
                return;
            default:
                ApkInstaller.cleanup(ctx, pkg);
                Notifications.clearConfirmation(ctx, pkg);
                InstallEvents.emit(pkg, "failed", 0, describe(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)));
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent confirmIntent(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) return intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    private static String describe(int status, String detail) {
        String base;
        switch (status) {
            case PackageInstaller.STATUS_FAILURE_BLOCKED: base = "Blocked by the device"; break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT: base = "Conflicts with the installed app (different signing key?) — uninstall it first"; break;
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE: base = "Not compatible with this device"; break;
            case PackageInstaller.STATUS_FAILURE_INVALID: base = "The downloaded file is invalid"; break;
            case PackageInstaller.STATUS_FAILURE_STORAGE: base = "Not enough storage"; break;
            default: base = "Install failed";
        }
        return detail == null || detail.isEmpty() ? base : base + " (" + detail + ")";
    }
}
