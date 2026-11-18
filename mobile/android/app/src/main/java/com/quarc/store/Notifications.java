package com.quarc.store;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.List;

final class Notifications {
    private Notifications() {}

    private static final String CHANNEL = "updates";
    private static final int ID_UPDATES = 1;
    private static final String PREFS = "quarc_notifications";

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, ctx.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription(ctx.getString(R.string.channel_updates_desc));
        nm.createNotificationChannel(ch);
    }

    private static boolean allowed(Context ctx) {
        return NotificationManagerCompat.from(ctx).areNotificationsEnabled();
    }

    /** Opens the Store on a quarcstore:// route. */
    private static PendingIntent openStore(Context ctx, String route, int requestCode) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("quarcstore://" + route), ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressWarnings("MissingPermission")
    static void updatesAvailable(Context ctx, List<UpdateWorker.Update> updates) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (updates.isEmpty()) {
            NotificationManagerCompat.from(ctx).cancel(ID_UPDATES);
            p.edit().remove("last").apply();
            return;
        }
        // Only notify again when the set of available versions changed.
        StringBuilder key = new StringBuilder();
        StringBuilder names = new StringBuilder();
        int required = 0;
        for (UpdateWorker.Update u : updates) {
            key.append(u.pkg).append('@').append(u.version).append(u.required ? "!" : "").append(';');
            if (names.length() > 0) names.append(", ");
            names.append(u.name).append(u.required ? " (required)" : "");
            if (u.required) required++;
        }
        if (key.toString().equals(p.getString("last", null))) return;
        p.edit().putString("last", key.toString()).apply();
        if (!allowed(ctx)) return;

        ensureChannel(ctx);
        String title;
        if (updates.size() == 1) {
            UpdateWorker.Update u = updates.get(0);
            title = u.required ? "Required update: " + u.name + " " + u.version : u.name + " " + u.version + " is available";
        } else {
            title = updates.size() + " Quarc app updates available" + (required > 0 ? " (" + required + " required)" : "");
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_store)
            .setContentTitle(title)
            .setContentText(names.toString())
            .setStyle(new NotificationCompat.BigTextStyle().bigText(names.toString()))
            .setContentIntent(openStore(ctx, "updates", ID_UPDATES))
            .setAutoCancel(true);
        NotificationManagerCompat.from(ctx).notify(ID_UPDATES, b.build());
    }

    @SuppressWarnings("MissingPermission")
    static void updated(Context ctx, String pkg, String label, String version) {
        if (!allowed(ctx)) return;
        ensureChannel(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_store)
            .setContentTitle((label == null ? pkg : label) + " updated")
            .setContentText(version == null || version.isEmpty() ? "Installed the latest version" : "Now on version " + version)
            .setContentIntent(openStore(ctx, "app/" + pkg, pkg.hashCode()))
            .setAutoCancel(true);
        NotificationManagerCompat.from(ctx).notify(pkg.hashCode(), b.build());
    }

    /** Background install that Android wants the user to confirm. */
    @SuppressWarnings("MissingPermission")
    static void needsConfirmation(Context ctx, String pkg, String label, Intent confirm) {
        if (!allowed(ctx)) return;
        ensureChannel(ctx);
        PendingIntent pi = PendingIntent.getActivity(ctx, pkg.hashCode() + 1, confirm, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_store)
            .setContentTitle("Tap to finish updating " + (label == null ? pkg : label))
            .setContentText("Android needs your OK for this update")
            .setContentIntent(pi)
            .setAutoCancel(true);
        NotificationManagerCompat.from(ctx).notify(pkg.hashCode() + 1, b.build());
    }

    static void clearConfirmation(Context ctx, String pkg) {
        NotificationManagerCompat.from(ctx).cancel(pkg.hashCode() + 1);
    }
}
