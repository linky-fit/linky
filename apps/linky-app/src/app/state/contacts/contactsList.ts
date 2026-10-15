import { Atom } from "effect/reactivity";
import { collectUnreadNewestIncomingByContactId } from "../../lib/chatUnread";
import { bankPaymentOfferMessagesAtom } from "../messages/bankOffers";
import {
  localMessagesAtom,
  messagesVisibleSinceSecAtom,
} from "../messages/readModel";
import { contactsAtom } from "./readModel";

/** The contacts tab's search text. */
export const contactsSearchAtom = Atom.keepAlive(Atom.make(""));

/** The group, status or archive filter the contacts tab shows, or null for all. */
export const activeContactGroupAtom = Atom.keepAlive(
  Atom.make<string | null>(null),
);

export const contactsFilterOpenAtom = Atom.keepAlive(Atom.make(false));

const makeInputRef = (): { current: HTMLInputElement | null } => ({
  current: null,
});

/** The search field, focused when the filter opens. */
export const contactsSearchInputRefAtom = Atom.keepAlive(
  Atom.readable(makeInputRef),
);

/** The newest unread incoming message per conversation, proxy offers included. */
export const unreadByContactIdAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const lastSeenAtSecByContactId = new Map<string, number>();
    for (const contact of get(contactsAtom)) {
      const contactId = contact.id.trim();
      const lastSeenAtSec = contact.chatLastSeenAtSec ?? 0;
      if (!contactId || !Number.isFinite(lastSeenAtSec) || lastSeenAtSec <= 0) {
        continue;
      }
      lastSeenAtSecByContactId.set(contactId, lastSeenAtSec);
    }
    return collectUnreadNewestIncomingByContactId(
      [...get(localMessagesAtom), ...get(bankPaymentOfferMessagesAtom)],
      lastSeenAtSecByContactId,
      get(messagesVisibleSinceSecAtom),
    );
  }),
);
