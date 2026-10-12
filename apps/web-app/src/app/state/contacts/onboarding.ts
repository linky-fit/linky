import {
  CONTACTS_ONBOARDING_HAS_BACKUPED_KEYS_STORAGE_KEY,
  CONTACTS_ONBOARDING_HAS_PAID_STORAGE_KEY,
} from "../../../utils/constants";
import { Atom } from "effect/reactivity";
import { parseProfileGeneralStatus } from "../../../nostrStatus";
import { bankPaymentOfferMessagesAtom } from "../messages/bankOffers";
import { messagesByContactAtom } from "../messages/readModel";
import { kvSeededAtom } from "../platform";
import { myProfileAtom, ownedLightningAddressesAtom } from "./profiles";
import { contactGroupsAtom } from "./readModel";

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

/** The user owns a name@linky.fit lightning address, a step of the contacts onboarding. */
export const hasLinkyNameAtom = Atom.readable((get) =>
  get(ownedLightningAddressesAtom).addresses.some((address) =>
    address.toLowerCase().endsWith("@linky.fit"),
  ),
);

/** A contact is in a group, a step of the contacts onboarding. */
export const hasContactGroupsAtom = Atom.readable(
  (get) => get(contactGroupsAtom).groupNames.length > 0,
);

/** The user offers a currency or took part in a proxy payment, a step of the contacts onboarding. */
export const hasProxyPaymentSetupAtom = Atom.readable(
  (get) =>
    parseProfileGeneralStatus(get(myProfileAtom).status).currencies.length >
      0 || get(bankPaymentOfferMessagesAtom).length > 0,
);

/** The user sent a message among the recent ones, a step of the contacts onboarding. */
export const contactsOnboardingHasSentMessageAtom = Atom.readable((get) =>
  get(messagesByContactAtom).recentMessages.some(
    (message) => message.direction === "out",
  ),
);
