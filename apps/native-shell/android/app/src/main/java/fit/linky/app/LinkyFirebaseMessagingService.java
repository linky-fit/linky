package fit.linky.app;

import android.content.Intent;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public final class LinkyFirebaseMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        if (remoteMessage.getNotification() != null) {
            return;
        }

        if (MainActivity.isAppInForeground()) {
            return;
        }

        Map<String, String> data = remoteMessage.getData();
        String messageId = LinkyPushNotifications.normalizeText(
            remoteMessage.getMessageId(),
            "linky-native-message"
        );
        Intent launchIntent = LinkyPushNotifications.createLaunchIntent(this, data);
        launchIntent.putExtra("google.message_id", messageId);
        LinkyPushNotifications.show(this, data, launchIntent, messageId);
    }
}
