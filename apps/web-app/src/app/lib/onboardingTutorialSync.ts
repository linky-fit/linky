import * as Evolu from "@evolu/common";

const parseNonEmptyString100 = (
  value: string,
): typeof Evolu.NonEmptyString100.Type => {
  const parsed = Evolu.NonEmptyString100.fromUnknown(value);
  if (!parsed.ok) throw new Error("Invalid onboarding tutorial metadata");
  return parsed.value;
};

const parseNonEmptyString1000 = (
  value: string,
): typeof Evolu.NonEmptyString1000.Type => {
  const parsed = Evolu.NonEmptyString1000.fromUnknown(value);
  if (!parsed.ok) throw new Error("Invalid onboarding tutorial metadata");
  return parsed.value;
};

export const ONBOARDING_TUTORIAL_OWNER_META_SCOPE =
  parseNonEmptyString100("onboardingTutorial");

const ONBOARDING_TUTORIAL_DISMISSED_VALUE =
  parseNonEmptyString1000("dismissed");

const ONBOARDING_TUTORIAL_OWNER_META_ROW_ID =
  Evolu.createIdFromString<"OwnerMeta">("onboarding-tutorial-status");

export const buildDismissedOnboardingTutorialOwnerMetaPayload = () => ({
  id: ONBOARDING_TUTORIAL_OWNER_META_ROW_ID,
  scope: ONBOARDING_TUTORIAL_OWNER_META_SCOPE,
  value: ONBOARDING_TUTORIAL_DISMISSED_VALUE,
});

export const hasDismissedOnboardingTutorialOwnerMetaRow = (
  rows: ReadonlyArray<object>,
  ownerId: Evolu.OwnerId | null,
): boolean => {
  if (!ownerId) return false;
  const expectedOwnerId = ownerId;

  return rows.some((row) => {
    if (!("ownerId" in row) || String(row.ownerId) !== expectedOwnerId) {
      return false;
    }
    return "value" in row && row.value === ONBOARDING_TUTORIAL_DISMISSED_VALUE;
  });
};
