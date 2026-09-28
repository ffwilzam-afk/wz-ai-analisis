package com.wzmanagepro.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class WzFirebaseMessagingService extends FirebaseMessagingService {

    private static final String CHANNEL_ID = "wz_manage_pro";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        String title = remoteMessage.getNotification() != null
                ? remoteMessage.getNotification().getTitle()
                : null;

        String body = remoteMessage.getNotification() != null
                ? remoteMessage.getNotification().getBody()
                : null;

        if (title == null || title.isEmpty()) {
            title = "WZ MANAGE PRO";
        }

        if (body == null || body.isEmpty()) {
            body = "Ada informasi baru.";
        }

        String type = remoteMessage.getData().get("type");
        String reportId = remoteMessage.getData().get("reportId");

        showNotification(title, body, type, reportId);
        MainActivity.notifyNewReport(type, reportId);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        getSharedPreferences("wz_fcm", MODE_PRIVATE)
                .edit()
                .putString("fcm_token", token)
                .apply();
    }

    // Channel hanya perlu dibuat satu kali. createNotificationChannel() yang
    // dipanggil ulang untuk channel yang sudah ada hanya membuang usaha, jadi
    // di sini lebih dulu dicek apakah channel-nya sudah tersedia.
    private void ensureNotificationChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        if (manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "WZ MANAGE PRO",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Notifikasi WZ MANAGE PRO");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0, 500, 200, 500});
        channel.setSound(
                android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
                new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
        );
        manager.createNotificationChannel(channel);
    }

    private void showNotification(String title, String body, String type, String reportId) {
        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        ensureNotificationChannel(manager);

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        if (type != null && !type.isEmpty()) {
            intent.putExtra("notification_type", type);
        }

        if (reportId != null && !reportId.isEmpty()) {
            intent.putExtra("notification_report_id", reportId);
        }

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        NotificationCompat.Builder builder =
                new NotificationCompat.Builder(this, CHANNEL_ID)
                        .setSmallIcon(R.drawable.ic_stat_wz)
                        .setContentTitle(title)
                        .setContentText(body)
                        .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setAutoCancel(true)
                        .setContentIntent(pendingIntent);

        manager.notify((int) System.currentTimeMillis(), builder.build());
    }
}
