import {
  parseSharedListingMessage,
  type SharedListing,
} from "@linky-fit/linkstr";
import { useAtom, useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import type { MessageId } from "@linky-fit/linksync";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { navigateTo } from "../../hooks/useRouting";
import { attachedListingsAtom } from "../state/messages/chat";
import { storedMessageAtom } from "../state/messages/readModel";

/** The listing copy the stored message `messageId` carries; null while there is none. */
export const useSharedListingOfMessage = (
  messageId: MessageId | null,
): SharedListing | null => {
  const content = useAtomValue(storedMessageAtom(messageId))?.content ?? null;
  return React.useMemo(
    () =>
      content === null
        ? null
        : (parseSharedListingMessage(content)?.shared ?? null),
    [content],
  );
};

/** The chat the stored message `messageId` belongs to. */
export const useChatIdOfMessage = (
  messageId: MessageId | null,
): string | null =>
  useAtomValue(storedMessageAtom(messageId))?.contactId ?? null;

const withAttached = (chatId: string, shared: SharedListing) => {
  reportAppLog({
    tag: "listings.attached",
    summary: `Listing attached to a chat: ${shared.listing.side}`,
    links: { contact: chatId, pubkey: shared.author },
    payload: { listingId: shared.listing.id },
  });
  return (current: Readonly<Record<string, SharedListing>>) => ({
    ...current,
    [chatId]: shared,
  });
};

/** The listing attached to the composer of chat `chatId`, and the ways to change it. */
export const useAttachedListing = (chatId: string) => {
  const [attachedListings, setAttachedListings] = useAtom(attachedListingsAtom);
  const attach = React.useCallback(
    (shared: SharedListing) =>
      setAttachedListings(withAttached(chatId, shared)),
    [chatId, setAttachedListings],
  );
  const clear = React.useCallback(
    () =>
      setAttachedListings((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== chatId),
        ),
      ),
    [chatId, setAttachedListings],
  );
  return { attached: attachedListings[chatId] ?? null, attach, clear };
};

/** Opens the chat `chatId`, a contact's or an unknown peer's, with a listing attached to its composer. */
export const useAttachListingToChat = (): ((
  chatId: string,
  shared: SharedListing,
) => void) => {
  const setAttachedListings = useAtomSet(attachedListingsAtom);
  return React.useCallback(
    (chatId, shared) => {
      setAttachedListings(withAttached(chatId, shared));
      navigateTo({ route: "chat", id: chatId });
    },
    [setAttachedListings],
  );
};
