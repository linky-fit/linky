import {
  hiddenListingKeysOf,
  type HiddenListingsRepository,
} from "@linky-fit/linksync";
import { useRepositoryRows } from "@linky-fit/linksync/react";
import type { Pubkey } from "@linky-fit/linkstr";
import { useAtomSuspense } from "@linky-fit/linkstr-react";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { hiddenListingsRepositoryAtom } from "../state/session/store";

const useHiddenListingsRepository = (): HiddenListingsRepository =>
  useAtomSuspense(hiddenListingsRepositoryAtom).value;

/** Others' listings the user hid, as `hiddenListingKey(author, listingId)`s. */
export const useHiddenListingKeys = (): ReadonlySet<string> => {
  const rows = useRepositoryRows(useHiddenListingsRepository());
  return React.useMemo(() => hiddenListingKeysOf(rows), [rows]);
};

/** Hides someone's listing on every device, or shows it again. */
export const useSetListingHidden = (): ((
  author: Pubkey,
  listingId: string,
  hidden: boolean,
) => Promise<WriteOutcome>) => {
  const repository = useHiddenListingsRepository();
  return React.useCallback(
    async (author, listingId, hidden) => {
      const outcome = await runWrite(
        repository.setHidden(author, listingId, hidden),
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
    [repository],
  );
};
