import { Atom } from "effect/reactivity";
import {
  loadCachedRelayLists,
  withRecommendedNostrRelays,
} from "../../../utils/nostrRelays";
import { loadRecommendedRelays } from "../../../utils/recommendedRelays";
import { lazyStateAtom } from "../platform";
import { currentPubkeyAtom } from "../session/session";
import { ownerCommandsAtom } from "../shell/ownerCommands";

/** The cached linky.fit relay recommendation; `useRecommendedRelays` refreshes it. */
export const recommendedRelaysAtom = lazyStateAtom(() =>
  loadRecommendedRelays(),
);

/** The identity's Nostr relays, starting from this device's cache of its relay lists. */
export const nostrRelayUrlsAtom = lazyStateAtom((get): string[] => {
  const pubkey = get(currentPubkeyAtom);
  return withRecommendedNostrRelays(
    (pubkey === null ? null : loadCachedRelayLists(pubkey))?.relayUrls ?? [],
    get(recommendedRelaysAtom),
  );
});

/** The relay URL typed on the add-relay page. */
export const newRelayUrlAtom = Atom.keepAlive(Atom.make(""));

/** The relay whose delete was tapped once; a second tap within 5 s deletes it. */
export const pendingRelayDeleteUrlAtom = Atom.keepAlive(
  Atom.make<string | null>(null),
);

export interface RelayCommands {
  readonly saveNewRelay: () => void;
  readonly requestDeleteSelectedRelay: () => void;
}

/** Relay list edits, which publish the lists the relay sync keeps reconciled. */
export const relayCommandsAtom = ownerCommandsAtom<RelayCommands>();
