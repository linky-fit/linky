import { ONBOARDER_HASH_PARAM } from "../app/lib/deepLinkHash";
import { isNativePlatform } from "../platform/runtime";

const HOSTED_APP_ORIGIN = "https://app.linky.fit";

interface OnboardingLinkParts {
  readonly giftToken: string | null;
  readonly onboarderNpub: string;
}

const appBaseUrl = (): string => {
  if (typeof window === "undefined" || isNativePlatform()) {
    return `${HOSTED_APP_ORIGIN}/`;
  }
  return `${window.location.origin}${window.location.pathname}`;
};

/**
 * Link for the onboarding QR: opens the web app with the onboarder's npub
 * and, when a welcome-gift token is attached, the token, both in the hash
 * query that `parkDeepLinkFromHash` moves into storage at boot.
 */
export const buildOnboardingUrl = ({
  giftToken,
  onboarderNpub,
}: OnboardingLinkParts): string => {
  const params = new URLSearchParams({ [ONBOARDER_HASH_PARAM]: onboarderNpub });
  if (giftToken) params.set("cashu", giftToken);
  return `${appBaseUrl()}#wallet?${params.toString()}`;
};
