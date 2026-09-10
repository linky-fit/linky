import { Schema } from "effect";
import { ONBOARDING_GIFT_SAT, ONBOARDING_GIFT_STORAGE_KEY } from "./constants";
import { safeLocalStorageGetJson } from "./storage";

export const OnboardingGift = Schema.Struct({
  amountSat: Schema.Int.pipe(Schema.nonNegative()),
  enabled: Schema.Boolean,
});
export type OnboardingGift = typeof OnboardingGift.Type;

export const DEFAULT_ONBOARDING_GIFT: OnboardingGift = {
  amountSat: ONBOARDING_GIFT_SAT,
  enabled: true,
};

/** `null` until the user has confirmed the gift once (settings or first onboarding). */
export const getInitialOnboardingGift = (): OnboardingGift | null =>
  safeLocalStorageGetJson(
    ONBOARDING_GIFT_STORAGE_KEY,
    Schema.NullOr(OnboardingGift),
    null,
  );

export const onboardingGiftAmountSat = (gift: OnboardingGift | null): number =>
  gift === null || !gift.enabled ? 0 : gift.amountSat;
