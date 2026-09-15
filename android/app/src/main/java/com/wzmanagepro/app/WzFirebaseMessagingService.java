package com.wzmanagepro.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
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

        showNotification(title, body);
        speakNotification(body);
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

    private void showNotification(String title, String body) {
        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "WZ MANAGE PRO",
                    NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notifikasi WZ MANAGE PRO");
            manager.createNotificationChannel(channel);
        }

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);

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
