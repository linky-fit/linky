package fit.linky.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/** Renders a push from the Linky push service, whichever transport (FCM or UnifiedPush) delivered it. */
final class LinkyPushNotifications {
    private static final String EXTRA_NOTIFICATION_ROUTE = "linky_notification_route";
    private static final String NOTIFICATION_ROUTE_CONTACTS = "#contacts";

    private LinkyPushNotifications() {}

    /**
     * Flattens the Web Push envelope `{ title, body, data: {...} }` into the same
     * string map FCM data messages carry, or returns null for anything else.
     */
    static Map<String, String> parseWebPushEnvelope(String json) {
        try {
            JSONObject envelope = new JSONObject(json);
            Map<String, String> data = new HashMap<>();
            JSONObject nested = envelope.optJSONObject("data");
            if (nested != null) {
                for (Iterator<String> keys = nested.keys(); keys.hasNext(); ) {
                    String key = keys.next();
                    data.put(key, String.valueOf(nested.get(key)));
                }
            }
            data.put("title", envelope.optString("title"));
            data.put("body", envelope.optString("body"));
            return data;
        } catch (Exception error) {
            return null;
        }
    }

    static Intent createLaunchIntent(Context context, Map<String, String> data) {
        Intent launchIntent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        for (String key : new String[] { "outerEventId", "recipientPubkey" }) {
            String value = data.get(key);
            if (value != null) {
                launchIntent.putExtra(key, value);
            }
        }
        launchIntent.putExtra(EXTRA_NOTIFICATION_ROUTE, NOTIFICATION_ROUTE_CONTACTS);
        return launchIntent;
    }

    /** `fallbackKey` names the notification when the push is not about a message (a recurring reminder). */
    static void show(Context context, Map<String, String> data, Intent launchIntent, String fallbackKey) {
        createNotificationChannelIfNeeded(context);

        String title = normalizeText(
            data.get("title"),
            context.getString(R.string.push_notification_fallback_title)
        );
        String body = normalizeText(
            data.get("body"),
            context.getString(R.string.push_notification_fallback_body)
        );
        int notificationId = normalizeText(data.get("outerEventId"), fallbackKey).hashCode();

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            notificationId,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(
            context,
            context.getString(R.string.push_notification_channel_id)
        )
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setContentText(body)
            .setContentTitle(title)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setSmallIcon(R.drawable.ic_stat_linky)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body));

        NotificationManagerCompat.from(context).notify(notificationId, builder.build());
    }

    static String normalizeText(String value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String normalized = value.trim();
        return normalized.isEmpty() ? fallback : normalized;
    }

    private static void createNotificationChannelIfNeeded(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager notificationManager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager == null) {
            return;
        }

        String channelId = context.getString(R.string.push_notification_channel_id);
        if (notificationManager.getNotificationChannel(channelId) != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            channelId,
            context.getString(R.string.push_notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(context.getString(R.string.push_notification_channel_name));
        notificationManager.createNotificationChannel(channel);
    }
}
