import { Atom } from "effect/reactivity";
import { readBlockList, subscribeBlockList } from "../../lib/blockList";

/** The block list, current after every local block, unblock or mute list merge. */
export const blockListAtom = Atom.keepAlive(
  Atom.make((get) => {
    get.addFinalizer(subscribeBlockList(() => get.setSelf(readBlockList())));
    return readBlockList();
  }),
);
