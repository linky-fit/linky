import { RelayLists } from "@linky-fit/linkstr";
import type { RelayListsDraft } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const publishRelayListsAtom = linkstrRuntimeAtom.fn<RelayListsDraft>()(
  (draft) =>
    Effect.flatMap(RelayLists, (relayLists) =>
      relayLists.publishRelayLists(draft),
    ),
);

export const fetchOwnRelayListsAtom = linkstrRuntimeAtom.fn<void>()(() =>
  Effect.flatMap(RelayLists, (relayLists) => relayLists.fetchOwnRelayLists()),
);
