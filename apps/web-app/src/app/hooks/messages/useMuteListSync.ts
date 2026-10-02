import {
  fetchOwnMuteListAtom,
  publishMuteListAtom,
  useAtomSet,
} from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import {
  adoptMuteList,
  hasMergedMuteList,
  recordMuteListMerged,
} from "../../lib/blockList";

interface UseMuteListSyncParams {
  /** Nostr may start: the account is hydrated, its identity settled and the browser online. */
  enabled: boolean;
  /** The identity's pubkey; a new identity merges its own mute list too. */
  pubkey: string | null;
}

/**
 * Merges the identity's newest mute list into the block list on each start and
 * publishes the union when the list lacks a block. `muteListSynced` holds the
 * inbox only until this device's first merge for the identity has run.
 */
export const useMuteListSync = ({ enabled, pubkey }: UseMuteListSyncParams) => {
  const fetchOwnMuteList = useAtomSet(fetchOwnMuteListAtom, {
    mode: "promiseExit",
  });
  const publishMuteList = useAtomSet(publishMuteListAtom, {
    mode: "promiseExit",
  });
  const queueRef = React.useRef<Promise<boolean>>(Promise.resolve(false));
  const [syncedPubkey, setSyncedPubkey] = React.useState<string | null>(null);

  /** Resolves whether the list was fetched and merged. */
  const mergeOnce = React.useCallback(async (): Promise<boolean> => {
    const fetched = await fetchOwnMuteList();
    if (Exit.isFailure(fetched)) return false;
    const remote = fetched.value;
    const merge = adoptMuteList(remote);
    reportAppLog({
      tag: "blockList.muteListMerged",
      summary: `Mute list merged: ${merge.added.length} blocked${merge.publish ? ", republishing" : ""}`,
      links: remote === null ? {} : { wrap: [remote.eventId] },
      payload: {
        listCreatedAt: remote?.createdAt ?? null,
        added: merge.added,
        blocked: merge.blockList.length,
        publish: merge.publish,
      },
    });
    if (merge.publish) await publishMuteList(merge.blockList);
    return true;
  }, [fetchOwnMuteList, publishMuteList]);

  /** Fetches the newest list first, since a publish replaces it whole. */
  const syncMuteList = React.useCallback((): Promise<boolean> => {
    const merged = queueRef.current.then(mergeOnce);
    queueRef.current = merged;
    return merged;
  }, [mergeOnce]);
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
    syncMuteList,
  };
};
