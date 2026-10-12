import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { hasMergedMuteList, recordMuteListMerged } from "../../lib/blockList";
import { syncMuteListAtom } from "../../state/contacts/muteList";

interface UseMuteListSyncParams {
  /** Nostr may start: the account is hydrated, its identity settled and the browser online. */
  enabled: boolean;
  /** The identity's pubkey; a new identity merges its own mute list too. */
  pubkey: string | null;
}

/**
 * Merges the identity's newest mute list into the block list on each start and
 * publishes the result when it differs from the list. `muteListSynced` holds the
 * inbox only until this device's first merge for the identity has run.
 */
export const useMuteListSync = ({ enabled, pubkey }: UseMuteListSyncParams) => {
  const syncMuteList = useAtomValue(syncMuteListAtom);
  const [syncedPubkey, setSyncedPubkey] = React.useState<string | null>(null);

  const mergedBefore = React.useMemo(
    () => pubkey !== null && hasMergedMuteList(pubkey),
    [pubkey],
  );

  React.useEffect(() => {
    if (!enabled || pubkey === null || syncedPubkey === pubkey) return;
    void syncMuteList().then((merged) => {
      if (merged) recordMuteListMerged(pubkey);
      setSyncedPubkey(pubkey);
    });
  }, [enabled, pubkey, syncMuteList, syncedPubkey]);

  return {
    muteListSynced:
      mergedBefore || (pubkey !== null && syncedPubkey === pubkey),
  };
};
