import { linkstrCommands } from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import { Atom } from "effect/reactivity";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { adoptMuteList } from "../../lib/blockList";

/**
 * Merges the identity's newest mute list into the block list and publishes
 * the union when the list lacks a block; resolves whether it merged. Syncs
 * run one after another, since a publish replaces the list whole.
 */
export const syncMuteListAtom = Atom.keepAlive(
  Atom.readable((get) => {
    const { fetchOwnMuteList, publishMuteList } = linkstrCommands(get.registry);

    const mergeOnce = async (): Promise<boolean> => {
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
    };

    let queue: Promise<boolean> = Promise.resolve(false);
    return (): Promise<boolean> => {
      const merged = queue.then(mergeOnce);
      queue = merged;
      return merged;
    };
  }),
);
