import React from "react";
import { isNativePlatform } from "../../platform/runtime";

interface UsePushRegistrationLifecycleParams {
  currentNsec: string | null;
  enabled: boolean;
}

const PUSH_REVALIDATION_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const NATIVE_PUSH_REVALIDATION_COOLDOWN_MS = 5 * 60 * 1000;
const PUSH_REVALIDATION_FAILURE_RETRY_MS = 5 * 60 * 1000;

function isPushRegistrationRefreshMessage(
  value: unknown,
): value is { type: "push-received" | "push-subscription-change" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value.type === "push-received" ||
      value.type === "push-subscription-change")
  );
}

export const usePushRegistrationLifecycle = ({
  currentNsec,
  enabled,
}: UsePushRegistrationLifecycleParams): void => {
  const lastPushRevalidationMsRef = React.useRef(0);
  const lastNativePushRevalidationMsRef = React.useRef(0);

  const revalidateNativePushRegistration = React.useCallback(
    async (reason: string, force = false) => {
      if (!enabled) return;
      if (!currentNsec) return;
      if (!isNativePlatform()) return;

      try {
        if (reason === "foreground" && document.visibilityState !== "visible") {
          return;
        }
      } catch {
        // If visibility cannot be read, keep the best-effort registration path.
      }

      const now = Date.now();
      if (
        !force &&
        now - lastNativePushRevalidationMsRef.current <
          NATIVE_PUSH_REVALIDATION_COOLDOWN_MS
      ) {
        return;
      }

      lastNativePushRevalidationMsRef.current = now;
      try {
        const {
          arePushNotificationsDisabledByUser,
          registerPushNotifications,
        } = await import("../../utils/pushNotifications");
        if (arePushNotificationsDisabledByUser()) {
          return;
        }

        const result = await registerPushNotifications(currentNsec);
        if (!result.success) {
          lastNativePushRevalidationMsRef.current =
            Date.now() -
            NATIVE_PUSH_REVALIDATION_COOLDOWN_MS +
            PUSH_REVALIDATION_FAILURE_RETRY_MS;
          console.error(
            `Native push notification revalidation failed (${reason}):`,
            result.error ?? "unknown error",
          );
        }
      } catch (error) {
        lastNativePushRevalidationMsRef.current =
          Date.now() -
          NATIVE_PUSH_REVALIDATION_COOLDOWN_MS +
          PUSH_REVALIDATION_FAILURE_RETRY_MS;
        console.error(
          `Native push notification revalidation error (${reason}):`,
          error,
        );
      }
    },
    [enabled, currentNsec],
  );

  const revalidatePwaPushRegistration = React.useCallback(
    async (reason: string, force = false) => {
      if (!enabled) return;
      if (!currentNsec) return;
      if (isNativePlatform()) return;
      if (!("Notification" in window)) return;
      if (Notification.permission !== "granted") return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return;
      }

      try {
        if (reason === "foreground" && document.visibilityState !== "visible") {
          return;
        }
      } catch {
        // If visibility cannot be read, keep the best-effort registration path.
      }

      const now = Date.now();
      if (
        !force &&
        now - lastPushRevalidationMsRef.current < PUSH_REVALIDATION_COOLDOWN_MS
      ) {
        return;
      }

      lastPushRevalidationMsRef.current = now;
      try {
        const {
          arePushNotificationsDisabledByUser,
          registerPushNotifications,
        } = await import("../../utils/pushNotifications");
        if (arePushNotificationsDisabledByUser()) {
          return;
        }

        const result = await registerPushNotifications(currentNsec);
        if (!result.success) {
          lastPushRevalidationMsRef.current =
            Date.now() -
            PUSH_REVALIDATION_COOLDOWN_MS +
            PUSH_REVALIDATION_FAILURE_RETRY_MS;
          console.error(
            `Push notification revalidation failed (${reason}):`,
            result.error ?? "unknown error",
          );
        }
      } catch (error) {
        lastPushRevalidationMsRef.current =
          Date.now() -
          PUSH_REVALIDATION_COOLDOWN_MS +
          PUSH_REVALIDATION_FAILURE_RETRY_MS;
        console.error(
          `Push notification revalidation error (${reason}):`,
          error,
        );
      }
    },
    [enabled, currentNsec],
  );

  React.useEffect(() => {
    if (!enabled) return;
    if (!currentNsec) return;

    const initPush = async () => {
      try {
        const {
          arePushNotificationsDisabledByUser,
          registerPushNotifications,
        } = await import("../../utils/pushNotifications");
        if (arePushNotificationsDisabledByUser()) {
          return;
        }

        if (isNativePlatform()) {
          const result = await registerPushNotifications(currentNsec);
          if (!result.success) {
            console.error(
              "Native push notification registration failed:",
              result.error ?? "unknown error",
            );
          } else {
            lastNativePushRevalidationMsRef.current = Date.now();
          }
          return;
        }

        if (Notification.permission === "granted") {
          const result = await registerPushNotifications(currentNsec);
          if (!result.success) {
            console.error(
              "Push notification registration failed:",
              result.error ?? "unknown error",
            );
          }
          return;
        }

        if (Notification.permission === "default") {
          const granted = await Notification.requestPermission();
          if (granted === "granted") {
            const result = await registerPushNotifications(currentNsec);
            if (!result.success) {
              console.error(
                "Push notification registration failed:",
                result.error ?? "unknown error",
              );
            }
          }
        }
      } catch (error) {
        console.error("Push notification initialization error:", error);
      }
    };

    if (isNativePlatform()) {
      void initPush();
      return;
    }

    if ("serviceWorker" in navigator && "PushManager" in window) {
      void initPush();
    }
  }, [enabled, currentNsec]);

  React.useEffect(() => {
    if (!currentNsec) return;
    if (!isNativePlatform()) return;

    const refresh = () => {
      void revalidateNativePushRegistration("foreground");
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [currentNsec, revalidateNativePushRegistration]);

  React.useEffect(() => {
    if (!currentNsec) return;
    if (isNativePlatform()) return;

    const refresh = () => {
      void revalidatePwaPushRegistration("foreground");
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [currentNsec, revalidatePwaPushRegistration]);

  React.useEffect(() => {
    if (!currentNsec) {
      return;
    }

    if (isNativePlatform()) {
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }

    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (!isPushRegistrationRefreshMessage(event.data)) {
        return;
      }

      if (Notification.permission !== "granted") {
        return;
      }

      void revalidatePwaPushRegistration(
        event.data.type,
        event.data.type === "push-subscription-change",
      );
    };

    navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener(
        "message",
        onServiceWorkerMessage,
      );
    };
  }, [currentNsec, revalidatePwaPushRegistration]);
};
