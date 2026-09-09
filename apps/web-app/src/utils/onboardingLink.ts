import { isNativePlatform } from "../platform/runtime";

const HOSTED_APP_ORIGIN = "https://app.linky.fit";

const appBaseUrl = (): string => {
  if (typeof window === "undefined" || isNativePlatform()) {
    return `${HOSTED_APP_ORIGIN}/`;
  }
  return `${window.location.origin}${window.location.pathname}`;
};

/**
 * Link for the onboarding QR: opens the web app and, when a welcome-gift
 * token is attached, carries it in the `#wallet?cashu=` deep link that both
 * the unauthenticated and the authenticated shell consume.
 */
export const buildOnboardingUrl = (giftToken: string | null): string => {
  const base = appBaseUrl();
  if (!giftToken) return base;
  return `${base}#wallet?cashu=${encodeURIComponent(giftToken)}`;
};
