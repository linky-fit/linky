package fit.linky.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public final class LinkyFirebaseMessagingService extends MessagingService {
    private static final String EXTRA_NOTIFICATION_ROUTE = "linky_notification_route";
    private static final String NOTIFICATION_ROUTE_CONTACTS = "#contacts";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        if (remoteMessage.getNotification() != null) {
            return;
        }

        if (MainActivity.isAppInForeground()) {
            return;
        }

        showBackgroundNotification(remoteMessage);
    }

    private void showBackgroundNotification(RemoteMessage remoteMessage) {
        createNotificationChannelIfNeeded();

        Map<String, String> data = remoteMessage.getData();
        String title = normalizeText(
            data.get("title"),
            getString(R.string.push_notification_fallback_title)
        );
        String body = normalizeText(
            data.get("body"),
            getString(R.string.push_notification_fallback_body)
        );

        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        for (String key : new String[] { "outerEventId", "recipientPubkey" }) {
            String value = data.get(key);
            if (value != null) {
                launchIntent.putExtra(key, value);
            }
        }
        launchIntent.putExtra(EXTRA_NOTIFICATION_ROUTE, NOTIFICATION_ROUTE_CONTACTS);
        launchIntent.putExtra(
            "google.message_id",
            normalizeText(remoteMessage.getMessageId(), "linky-native-message")
        );

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            buildNotificationId(remoteMessage),
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(
            this,
            getString(R.string.push_notification_channel_id)
        )
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setContentText(body)
            .setContentTitle(title)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body));

        NotificationManagerCompat.from(this).notify(
            buildNotificationId(remoteMessage),
            builder.build()
        );
    }

    private void createNotificationChannelIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager notificationManager =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) {
            return;
        }

        String channelId = getString(R.string.push_notification_channel_id);
        NotificationChannel existingChannel = notificationManager.getNotificationChannel(channelId);
        if (existingChannel != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            channelId,
            getString(R.string.push_notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(getString(R.string.push_notification_channel_name));
        notificationManager.createNotificationChannel(channel);
    }

    private int buildNotificationId(RemoteMessage remoteMessage) {
        String outerEventId = remoteMessage.getData().get("outerEventId");
        if (outerEventId != null && !outerEventId.trim().isEmpty()) {
            return outerEventId.hashCode();
        }
        String messageId = remoteMessage.getMessageId();
        return normalizeText(messageId, "linky-native-message").hashCode();
    }

    private String normalizeText(String value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? fallback : normalized;
    }
}
