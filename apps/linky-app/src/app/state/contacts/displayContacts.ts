import { encodeNpub, Pubkey } from "@linky-fit/linkstr";
import { Option } from "effect";
import { Atom } from "effect/reactivity";
import { keepUnchangedRows } from "../../../utils/structuralSharing";
import { mergeBankPaymentOffersIntoLastMessageByContactId } from "../../lib/bankPaymentOfferRows";
import {
  isUnknownContactId,
  normalizePubkeyHex,
  readUnknownContactIdPubkey,
} from "../../hooks/messages/contactIdentity";
import { bankPaymentOfferMessagesAtom } from "../messages/bankOffers";
import {
  localMessagesAtom,
  messagesByContactAtom,
} from "../messages/readModel";
import { currentPubkeyAtom } from "../session/session";
import { blockListAtom } from "./blockList";
import { unknownNamesAtom } from "./chatContacts";

/** The newest message per conversation, proxy payment offers included. */
export const lastVisibleMessageByContactIdAtom = Atom.keepAlive(
  Atom.readable((get) =>
    mergeBankPaymentOffersIntoLastMessageByContactId(
      get(messagesByContactAtom).lastMessageByContactId,
      get(bankPaymentOfferMessagesAtom),
    ),
  ),
);

/** A conversation with a peer who is not a contact, before its display name. */
export interface UnknownSender {
  readonly id: string;
  readonly npub: string | null;
  readonly unknownPubkeyHex: string | null;
  /** The peer's profile name, when one is known. */
  readonly profileName: string | null;
}

const encodeUnknownNpub = (pubkeyHex: string | null): string | null => {
  if (!pubkeyHex) return null;
  const pubkey = normalizePubkeyHex(pubkeyHex);
  return pubkey ? encodeNpub(Pubkey.make(pubkey)) : null;
};

/** Unknown senders with a conversation, without blocked peers or the user. */
export const unknownSendersAtom = Atom.keepAlive(
  Atom.readable((get): UnknownSender[] => {
    const messages = get(localMessagesAtom);
    const ownPubkey = normalizePubkeyHex(get(currentPubkeyAtom));
    const unknownNames = get(unknownNamesAtom);
    const blocked = new Set(get(blockListAtom));
    const unknownById = new Map<string, UnknownSender>();

    for (const [contactId, lastMessage] of get(
      lastVisibleMessageByContactIdAtom,
    )) {
      const normalizedContactId = contactId.trim();
      if (!normalizedContactId) continue;
      if (!isUnknownContactId(normalizedContactId)) continue;

      const candidatePubkeyFromLast = normalizePubkeyHex(lastMessage.pubkey);
      const candidatePubkeyFromId =
        readUnknownContactIdPubkey(normalizedContactId);
      const candidatePubkeyFromThread = messages
        .filter((message) => message.contactId.trim() === normalizedContactId)
        .map((message) => normalizePubkeyHex(message.pubkey))
        .find((pubkey) => {
          if (!pubkey) return false;
          if (blocked.has(pubkey)) return false;
          if (ownPubkey && ownPubkey === pubkey) return false;
          return true;
        });

      const unknownPubkeyHex =
        candidatePubkeyFromId ??
        candidatePubkeyFromThread ??
        candidatePubkeyFromLast ??
        null;
      if (unknownPubkeyHex && blocked.has(unknownPubkeyHex)) continue;
      if (unknownPubkeyHex && ownPubkey && unknownPubkeyHex === ownPubkey) {
        continue;
      }

      const npub = encodeUnknownNpub(unknownPubkeyHex);
      unknownById.set(normalizedContactId, {
        id: normalizedContactId,
        npub,
        unknownPubkeyHex,
        profileName: npub ? (unknownNames[npub] ?? null) : null,
      });
    }

    return keepUnchangedRows(
      Option.getOrUndefined(get.self<UnknownSender[]>()),
      Array.from(unknownById.values()),
    );
  }),
);
