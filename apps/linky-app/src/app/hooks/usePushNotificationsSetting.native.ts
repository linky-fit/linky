// Push notifications are not built for the Expo app yet.

export interface PushNotificationsSetting {
  /** False where the app cannot receive push notifications at all. */
  supported: boolean;
  enabled: boolean;
  isBusy: boolean;
  /** Resolves with the resulting state; toasts explain a failed change. */
  setEnabled: (enabled: boolean) => Promise<boolean>;
}

const unsupported: PushNotificationsSetting = {
  supported: false,
  enabled: false,
  isBusy: false,
  setEnabled: () => Promise.resolve(false),
};

export const usePushNotificationsSetting = (): PushNotificationsSetting =>
  unsupported;
