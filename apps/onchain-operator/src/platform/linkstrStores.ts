import { InboxCursorStore, OutboxStore, type Pubkey } from "@linky-fit/linkstr";

/** The outbox queue and inbox cursor of one identity, in localStorage. */
export const linkstrStores = (pubkey: Pubkey) => ({
  outboxStore: OutboxStore.fromStringStorage(
    localStorage,
    `linky.onchainOperator.outbox.${pubkey}`,
  ),
  inboxCursorStore: InboxCursorStore.fromStringStorage(
    localStorage,
    `linky.onchainOperator.inboxCursor.${pubkey}`,
  ),
});
