import {
  listingKeysOf,
  type HiddenListingsRepository,
  type ListingId,
  type PinnedListingsRepository,
} from "@linky-fit/linksync";
import { useRepositoryRows } from "@linky-fit/linksync/react";
import type { Pubkey } from "@linky-fit/linkstr";
import { useAtomSuspense } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { nowSeconds } from "../../utils/time";
import {
  hiddenListingsRepositoryAtom,
  pinnedListingsRepositoryAtom,
} from "../state/session/store";
import { useListingsRepository } from "./useLinksync";

const useHiddenListingsRepository = (): HiddenListingsRepository =>
  useAtomSuspense(hiddenListingsRepositoryAtom).value;

const usePinnedListingsRepository = (): PinnedListingsRepository =>
  useAtomSuspense(pinnedListingsRepositoryAtom).value;

/** Others' listings the user hid, as `listingKey(author, listingId)`s. */
export const useHiddenListingKeys = (): ReadonlySet<string> => {
  const rows = useRepositoryRows(useHiddenListingsRepository());
  return React.useMemo(() => listingKeysOf(rows), [rows]);
};

/** Others' listings the user pinned to the top, as `listingKey(author, listingId)`s. */
export const usePinnedListingKeys = (): ReadonlySet<string> => {
  const rows = useRepositoryRows(usePinnedListingsRepository());
  return React.useMemo(() => listingKeysOf(rows), [rows]);
};

/** Hides someone's listing on every device, unpinning it, or shows it again. */
export const useSetListingHidden = (): ((
  author: Pubkey,
  listingId: string,
  hidden: boolean,
) => Promise<WriteOutcome>) => {
  const hiddenListings = useHiddenListingsRepository();
  const pinnedListings = usePinnedListingsRepository();
  return React.useCallback(
    async (author, listingId, hidden) => {
      const outcome = await runWrite(
        Effect.andThen(
          hidden
            ? pinnedListings.setPinned(author, listingId, false)
            : Effect.void,
          hiddenListings.setHidden(author, listingId, hidden),
        ),
      );
      if (outcome.ok)
        reportAppLog({
          tag: hidden ? "listings.hidden" : "listings.shown",
          summary: hidden
            ? "Hid someone's listing"
            : "Showed someone's listing again",
          payload: { author, listingId },
        });
      return outcome;
    },
    [hiddenListings, pinnedListings],
  );
};

/** Pins someone's listing to the top on every device, showing it if hidden, or unpins it. */
export const useSetListingPinned = (): ((
  author: Pubkey,
  listingId: string,
  pinned: boolean,
) => Promise<WriteOutcome>) => {
  const hiddenListings = useHiddenListingsRepository();
  const pinnedListings = usePinnedListingsRepository();
  return React.useCallback(
    async (author, listingId, pinned) => {
      const outcome = await runWrite(
        Effect.andThen(
          pinned
            ? hiddenListings.setHidden(author, listingId, false)
            : Effect.void,
          pinnedListings.setPinned(author, listingId, pinned),
        ),
      );
      if (outcome.ok)
        reportAppLog({
          tag: pinned ? "listings.pinned" : "listings.unpinned",
          summary: pinned
            ? "Pinned someone's listing to the top"
            : "Unpinned someone's listing",
          payload: { author, listingId },
        });
      return outcome;
    },
    [hiddenListings, pinnedListings],
  );
};

/** Pauses one of the user's own listings, which stops publishing it, or resumes it. */
export const useSetListingPaused = (): ((
  listingId: ListingId,
  paused: boolean,
) => Promise<WriteOutcome>) => {
  const listings = useListingsRepository();
  return React.useCallback(
    async (listingId, paused) => {
      const outcome = await runWrite(
        listings.update(listingId, {
          pausedAtSec: paused ? nowSeconds() : null,
        }),
      );
      if (outcome.ok)
        reportAppLog({
          tag: paused ? "listings.paused" : "listings.resumed",
          summary: paused ? "Paused a listing" : "Resumed a listing",
          payload: { listingId },
        });
      return outcome;
    },
    [listings],
  );
};
