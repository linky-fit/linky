import type { Listing, Pubkey } from "@linky-fit/linkstr";
import type { ContactId } from "@linky-fit/linksync";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { navigateTo } from "../../hooks/useRouting";

/** A listing with its author, as the user shares it in a chat or replies to it. */
export interface SharedListing {
  readonly author: Pubkey;
  readonly listing: Listing;
}

/** Opens the chat with `contactId` with `shared` attached to the composer. */
export const attachListingToChat = (
  contactId: ContactId,
  shared: SharedListing,
): void => {
  reportAppLog({
    tag: "listings.attached",
    summary: `Listing attached to a chat: ${shared.listing.side}`,
    links: { contact: contactId, pubkey: shared.author },
    payload: { listingId: shared.listing.id },
  });
  navigateTo({ route: "chat", id: contactId });
};
