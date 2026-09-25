package com.wzmanagepro.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Locale;

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
        speakNotification(body);
        MainActivity.notifyNewReport(type, reportId);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        getSharedPreferences("wz_fcm", MODE_PRIVATE)
                .edit()
                .putString("fcm_token", token)
                .apply();
    }

    private void speakNotification(String message) {
        try {
            final TextToSpeech[] ttsHolder = new TextToSpeech[1];

            ttsHolder[0] = new TextToSpeech(
                    getApplicationContext(),
                    status -> {
                        try {
                            TextToSpeech tts = ttsHolder[0];

                            if (status == TextToSpeech.SUCCESS && tts != null) {
                                int result = tts.setLanguage(new Locale("id", "ID"));

                                if (result == TextToSpeech.LANG_MISSING_DATA
                                        || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                                    result = tts.setLanguage(Locale.getDefault());
                                }

                                if (result != TextToSpeech.LANG_MISSING_DATA
                                        && result != TextToSpeech.LANG_NOT_SUPPORTED) {
                                    tts.setSpeechRate(0.95f);
                                    tts.setPitch(1.0f);
                                    tts.speak(
                                            message,
                                            TextToSpeech.QUEUE_FLUSH,
                                            null,
                                            "wz_notification"
                                    );
                                    new Handler(Looper.getMainLooper())
                                            .postDelayed(tts::shutdown, 5000L);
                                }
                            }
                        } catch (Exception ignored) {
                        }
                    }
            );
        } catch (Exception ignored) {
            // TTS tidak boleh membuat notifikasi gagal.
        }
    }

    private void showNotification(String title, String body, String type, String reportId) {
        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
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
