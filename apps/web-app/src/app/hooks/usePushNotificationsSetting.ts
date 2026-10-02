import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { getNativeNotificationPermissionState } from "../../platform/nativeBridge";
import { isNativePlatform } from "../../platform/runtime";
import { useAppShellCore } from "../context/AppShellContexts";
import { useAdvancedSettingsContext } from "../context/SystemSettingsContexts";

export interface PushNotificationsSetting {
  enabled: boolean;
  isBusy: boolean;
  /** Resolves with the resulting state; toasts explain a failed change. */
  setEnabled: (enabled: boolean) => Promise<boolean>;
}

const readPushNotificationsEnabled = async (
  currentNsec: string | null,
): Promise<boolean> => {
  const {
    arePushNotificationsDisabledByUser,
    hasNativePushRegistrationForIdentity,
  } = await import("../../utils/pushNotifications");
  if (arePushNotificationsDisabledByUser()) return false;

  if (isNativePlatform()) {
    const permissionGranted =
      getNativeNotificationPermissionState() === "granted";
    const registrationStored = currentNsec
      ? await hasNativePushRegistrationForIdentity(currentNsec)
      : false;
    return permissionGranted && registrationStored;
  }

  if (
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    !("serviceWorker" in navigator)
  ) {
    return false;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration
    ? await registration.pushManager.getSubscription()
    : null;
  return subscription !== null;
};

/** The push notification switch shared by Advanced settings and Proxy payments. */
export const usePushNotificationsSetting = (): PushNotificationsSetting => {
  const { currentNsec, t } = useAppShellCore();
  const { pushToast } = useAdvancedSettingsContext();
  const [enabled, setEnabledState] = React.useState(false);
  const [isBusy, setIsBusy] = React.useState(false);

  React.useEffect(() => {
    let isActive = true;
    void readPushNotificationsEnabled(currentNsec)
      .catch(() => false)
      .then((value) => {
        if (isActive) setEnabledState(value);
      });
    return () => {
      isActive = false;
    };
  }, [currentNsec]);

  const setEnabled = React.useCallback(
    async (nextEnabled: boolean): Promise<boolean> => {
      if (!currentNsec) {
        pushToast(t("notificationsNotLoggedIn"));
        return false;
      }

      setIsBusy(true);
      try {
        const {
          registerPushNotifications,
          requestNotificationPermission,
          setPushNotificationsDisabledByUser,
          unregisterPushNotifications,
        } = await import("../../utils/pushNotifications");

        if (nextEnabled) {
          pushToast(t("notificationsRegistering"));
          const permissionGranted = await requestNotificationPermission();
          if (!permissionGranted) {
            setPushNotificationsDisabledByUser(true);
            const isUnsupported =
              isNativePlatform() &&
              getNativeNotificationPermissionState() === "unsupported";
            pushToast(
              t(
                isUnsupported
                  ? "notificationsUnsupported"
                  : "notificationsDenied",
              ),
            );
            return false;
          }

          const result = await registerPushNotifications(currentNsec);
          if (!result.success) {
            setPushNotificationsDisabledByUser(true);
            reportAppLog({
              tag: "push.registerFailed",
              summary: "Turning on push notifications failed",
              payload: { error: result.error ?? null },
            });
            pushToast(t("notificationsEnableError"));
            return false;
          }
          setPushNotificationsDisabledByUser(false);
          setEnabledState(true);
          pushToast(t("notificationsRegistered"));
          return true;
        }

        const disabled = await unregisterPushNotifications(currentNsec);
        if (!disabled) {
          pushToast(t("notificationsDisableError"));
          return true;
        }
        setEnabledState(false);
        pushToast(t("notificationsDisabled"));
        return false;
      } catch {
        pushToast(t("notificationsError"));
        return enabled;
      } finally {
        setIsBusy(false);
      }
    },
    [currentNsec, enabled, pushToast, t],
  );

  return { enabled, isBusy, setEnabled };
};
