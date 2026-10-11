import {
  CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
  CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY,
} from "../../../utils/constants";
import { kvSeededAtom } from "../platform";

const onboardingFlagAtom = (key: string) =>
  kvSeededAtom(
    (kv) => kv.getItem(key) === "1",
    (kv, done) => {
      if (done) kv.setItem(key, "1");
    },
  );

/** The user paid once on this device, a step of the contacts onboarding. */
export const contactsOnboardingHasPaidAtom = onboardingFlagAtom(
  CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY,
);

/** The user copied the recovery seed on this device, a step of the contacts onboarding. */
export const contactsOnboardingHasBackedUpKeysAtom = onboardingFlagAtom(
  CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
);
