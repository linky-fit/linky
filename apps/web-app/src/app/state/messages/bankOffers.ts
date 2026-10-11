import { decodeNpub, type Pubkey } from "@linky-fit/linkstr";
import {
  emptyBankPaymentOfferState,
  type BankPaymentOfferState,
} from "@linky-fit/proxy-payment";
import { Atom } from "effect/reactivity";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import {
  buildUnknownContactId,
  readUnknownContactIdPubkey,
} from "../../hooks/messages/contactIdentity";
import {
  bankPaymentOfferMessageRow,
  compareBankPaymentOfferRows,
} from "../../lib/bankPaymentOfferRows";
import { contactsAtom } from "../contacts/readModel";
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
