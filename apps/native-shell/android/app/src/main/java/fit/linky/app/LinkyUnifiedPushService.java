package fit.linky.app;

import android.util.Log;

import org.json.JSONObject;
import org.unifiedpush.android.connector.FailedReason;
import org.unifiedpush.android.connector.PushService;
import org.unifiedpush.android.connector.data.PublicKeySet;
import org.unifiedpush.android.connector.data.PushEndpoint;
import org.unifiedpush.android.connector.data.PushMessage;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Push transport for devices without Google Play Services, e.g. GrapheneOS with a distributor like ntfy. */
public final class LinkyUnifiedPushService extends PushService {
    private static final String LOG_TAG = "LinkyUnifiedPush";

    @Override
    public void onNewEndpoint(PushEndpoint endpoint, String instance) {
        PublicKeySet keys = endpoint.getPubKeySet();
        if (keys == null) {
            MainActivity.dispatchUnifiedPushFailure("MISSING_KEYS");
            return;
        }

        JSONObject detail = new JSONObject();
        try {
            detail.put("status", "endpoint");
            detail.put("endpoint", endpoint.getUrl());
            detail.put("p256dh", keys.getPubKey());
            detail.put("auth", keys.getAuth());
        } catch (Exception error) {
            MainActivity.dispatchUnifiedPushFailure("INTERNAL_ERROR");
            return;
        }
        MainActivity.dispatchUnifiedPushEvent(detail);
    }

    @Override
    public void onMessage(PushMessage message, String instance) {
        if (!message.getDecrypted()) {
            Log.w(LOG_TAG, "dropping a push that failed Web Push decryption");
            return;
        }

        if (MainActivity.isAppInForeground()) {
            return;
        }

        String content = new String(message.getContent(), StandardCharsets.UTF_8);
        Map<String, String> data = LinkyPushNotifications.parseWebPushEnvelope(content);
        if (data == null) {
            Log.w(LOG_TAG, "dropping a push that is not a Linky envelope");
            return;
        }

        LinkyPushNotifications.show(
            this,
            data,
            LinkyPushNotifications.createLaunchIntent(this, data),
            "linky-unifiedpush-" + content.hashCode()
        );
    }

    @Override
    public void onRegistrationFailed(FailedReason reason, String instance) {
        MainActivity.dispatchUnifiedPushFailure(reason.name());
    }

    @Override
    public void onUnregistered(String instance) {
        // The push service drops the endpoint once the distributor answers 404 or 410.
        Log.i(LOG_TAG, "distributor unregistered instance " + instance);
    }
}
