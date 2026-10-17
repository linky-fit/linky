interface UsePushRegistrationLifecycleParams {
  currentNsec: string | null;
  enabled: boolean;
}

/** Push notifications are not built for the Expo app yet. */
export const usePushRegistrationLifecycle: (
  params: UsePushRegistrationLifecycleParams,
) => void = () => {};
