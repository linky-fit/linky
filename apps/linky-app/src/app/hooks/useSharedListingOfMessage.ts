import type { MessageId } from "@linky-fit/linksync";
import type { SharedListing } from "../lib/sharedListing";

/** The listing copy the stored message `messageId` carries; null while there is none. */
export const useSharedListingOfMessage: (
  messageId: MessageId | null,
) => SharedListing | null = () => null;
