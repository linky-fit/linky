import type { FetchedMuteList } from "@linky-fit/linkstr";
import { linkstrCommands } from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import { Atom } from "effect/reactivity";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { adoptMuteList, toMuteListChanges } from "../../lib/blockList";

const MAX_PUBLISH_ROUNDS = 3;

/** `unknown` when the fetch could not tell what the relays hold. */
type MergeOutcome = "unknown" | "merged" | "published";

/**
 * Merges the identity's newest mute list into the block list and publishes the
 * result when it differs from the list; resolves whether it merged. Syncs run
 * one after another, since a publish replaces the list whole.
 */
export const syncMuteListAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const { fetchOwnMuteList, publishMuteList } = linkstrCommands(get.registry);

    const mergeOnce = async (mayPublish: boolean): Promise<MergeOutcome> => {
      const fetched = await fetchOwnMuteList();
      if (Exit.isFailure(fetched)) return "unknown";
      const remote = fetched.value;
      const merge = adoptMuteList(remote);
      reportAppLog({
        tag: "blockList.muteListMerged",
        summary: `Mute list merged: ${merge.added.length} blocked, ${merge.removed.length} unblocked${merge.publish ? ", republishing" : ""}`,
        links: remote === null ? {} : { wrap: [remote.eventId] },
        payload: {
          listCreatedAt: remote?.createdAt ?? null,
          added: merge.added,
          removed: merge.removed,
          blocked: merge.blockList.length,
          publish: merge.publish,
        },
      });
      if (!merge.publish || !mayPublish) return "merged";
      const published = await publishMuteList(merge.blockList, {
        changes: toMuteListChanges(merge.changes),
        ...(remote === null ? {} : { replaces: remote.createdAt }),
      });
      return Exit.isSuccess(published) ? "published" : "merged";
    };

    // A relay keeps only one of two lists published at once, so a publish is
    // checked by fetching again, and a lost one is merged and published anew;
    // the fetch after the last publish only merges.
    const sync = async (): Promise<boolean> => {
      const first = await mergeOnce(true);
      let outcome = first;
      for (
        let round = 1;
        outcome === "published" && round <= MAX_PUBLISH_ROUNDS;
        round += 1
      )
        outcome = await mergeOnce(round < MAX_PUBLISH_ROUNDS);
      return first !== "unknown";
    };

    let queue: Promise<boolean> = Promise.resolve(false);
    return (): Promise<boolean> => {
      const merged = queue.then(sync);
      queue = merged;
      return merged;
    };
  }),
);

/**
 * Merges a list the mute list watch delivered. When the merged list differs
 * from it, a sync publishes over the relays' newest list if that one differs
 * too, so this device's echo or an older list publishes nothing.
 */
export const mergeWatchedMuteListAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const syncMuteList = get(syncMuteListAtom);
    return (remote: FetchedMuteList): void => {
      const merge = adoptMuteList(remote);
      reportAppLog({
        tag: "blockList.muteListReceived",
        summary: `Newer mute list received: ${merge.added.length} blocked, ${merge.removed.length} unblocked${merge.publish ? ", syncing" : ""}`,
        links: { wrap: [remote.eventId] },
        payload: {
          listCreatedAt: remote.createdAt,
          added: merge.added,
          removed: merge.removed,
          blocked: merge.blockList.length,
          publish: merge.publish,
        },
      });
      if (merge.publish) void syncMuteList();
    };
  }),
);
