import { decodeNpub, type Pubkey } from "@linky-fit/linkstr";
import {
  BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT,
  BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC,
  clampBankPaymentOfferRecipientCount,
  clampBankPaymentOfferStaggerDelaySec,
  emptyBankPaymentOfferState,
  type BankOfferStatus,
  type BankPaymentOfferResponseOptions,
  type BankPaymentOfferState,
} from "@linky-fit/proxy-payment";
import { Atom } from "effect/reactivity";
import {
  BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY,
  BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY,
} from "../../../utils/constants";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  getInitialBankPaymentOfferRecipientCount,
  getInitialBankPaymentOfferStaggerDelaySec,
} from "../../../utils/storage";
import {
  buildUnknownContactId,
  readUnknownContactIdPubkey,
} from "../../hooks/messages/contactIdentity";
import {
  bankPaymentOfferMessageRow,
  compareBankPaymentOfferRows,
} from "../../lib/bankPaymentOfferRows";
import type { ContactRowLike, LocalNostrMessage } from "../../types/appTypes";
import { contactsAtom } from "../contacts/readModel";
import { kvSeededAtom } from "../platform";
import { ownerCommandsAtom } from "../shell/ownerCommands";
import { currentPubkeyAtom } from "../session/session";

/**
 * The proxy payment offers this session knows; the inbox and the offer
 * watchers in `useBankPaymentOffers` advance it.
 */
export const bankPaymentOfferStateAtom = Atom.keepAlive(
  Atom.make<BankPaymentOfferState>(emptyBankPaymentOfferState),
);

export interface ContactPubkeys {
  /** The contact a peer is saved as, or their unknown-sender id. */
  readonly contactIdFor: (pubkey: Pubkey) => string | null;
  readonly pubkeyFor: (contactId: string) => Pubkey | null;
}

// Offers are keyed by peer pubkey; the contact id is a display concern, so an
// unknown peer saved as a contact moves its offers without any bookkeeping.
export const contactPubkeysAtom = Atom.readable((get): ContactPubkeys => {
  const contactIdByPubkey = new Map<Pubkey, string>();
  const pubkeyByContactId = new Map<string, Pubkey>();
  for (const contact of get(contactsAtom)) {
    const id = (contact.id ?? "").trim();
    const npub = normalizeNpubIdentifier(contact.npub ?? "");
    const pubkey = npub ? decodeNpub(npub) : null;
    if (!id || !pubkey) continue;
    if (!contactIdByPubkey.has(pubkey)) contactIdByPubkey.set(pubkey, id);
    pubkeyByContactId.set(id, pubkey);
  }
  return {
    contactIdFor: (pubkey) =>
      contactIdByPubkey.get(pubkey) ?? buildUnknownContactId(pubkey),
    pubkeyFor: (contactId) =>
      pubkeyByContactId.get(contactId.trim()) ??
      readUnknownContactIdPubkey(contactId),
  };
});

/** Each offer as a row in its peer's conversation. */
export const bankPaymentOfferMessagesAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const myPubHex = get(currentPubkeyAtom);
    if (!myPubHex) return [];
    const { contactIdFor } = get(contactPubkeysAtom);
    return get(bankPaymentOfferStateAtom)
      .offers.flatMap((offer) => {
        const contactId = contactIdFor(offer.peer);
        return contactId
          ? [bankPaymentOfferMessageRow(offer, contactId, myPubHex)]
          : [];
      })
      .sort(compareBankPaymentOfferRows);
  }),
);

export interface BankOfferDefaults {
  readonly recipientCount: number;
  readonly staggerDelaySec: number;
}

/** How many payers the last offer went to and its stagger, the next offer's defaults. */
export const bankOfferDefaultsAtom = kvSeededAtom(
  (kv): BankOfferDefaults => ({
    recipientCount: clampBankPaymentOfferRecipientCount(
      getInitialBankPaymentOfferRecipientCount(
        BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT,
        kv,
      ),
    ),
    staggerDelaySec: clampBankPaymentOfferStaggerDelaySec(
      getInitialBankPaymentOfferStaggerDelaySec(
        BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC,
        kv,
      ),
    ),
  }),
  (kv, defaults) => {
    kv.setItem(
      BANK_PAYMENT_OFFER_RECIPIENT_COUNT_STORAGE_KEY,
      String(defaults.recipientCount),
    );
    kv.setItem(
      BANK_PAYMENT_OFFER_STAGGER_DELAY_SEC_STORAGE_KEY,
      String(defaults.staggerDelaySec),
    );
  },
  { persistSeed: true },
);

export interface BankPaymentOfferRequest {
  amountSat?: unknown;
  amountText: string;
  contacts: readonly ContactRowLike[];
  singleTabRiskAccepted?: boolean;
  spdPayload?: unknown;
  staggerDelaySec?: unknown;
}

export interface RequestedBankPaymentOffer {
  chatId: string;
  offerId: string;
}

export interface BankOfferCommands {
  /** Offers a bank QR to its payers, or opens its offer while one is live. */
  readonly requestBankPaymentOffer: (
    request: BankPaymentOfferRequest,
  ) => Promise<RequestedBankPaymentOffer | null>;
  /** Answers an offer from its chat row; closing or settling answers every payer. */
  readonly respondToBankPaymentOffer: (
    message: LocalNostrMessage,
    nextStatus: BankOfferStatus,
    options?: BankPaymentOfferResponseOptions,
  ) => Promise<boolean>;
}

/** The offer watchers' sends, kept with their in-flight dedupe in one place. */
export const bankOfferCommandsAtom = ownerCommandsAtom<BankOfferCommands>();
