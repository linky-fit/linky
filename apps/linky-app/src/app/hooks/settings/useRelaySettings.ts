import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { useRouting } from "../../../hooks/useRouting";
import {
  isRecommendedNostrRelay,
  isRelayUrl,
} from "../../../utils/nostrRelays";
import {
  newRelayUrlAtom,
  nostrRelayUrlsAtom,
  pendingRelayDeleteUrlAtom,
  recommendedRelaysAtom,
  relayCommandsAtom,
} from "../../state/messages/relays";

/** The identity's Nostr relays as the relay settings pages show and edit them. */
export const useRelaySettings = () => {
  const route = useRouting();
  const relayUrls = useAtomValue(nostrRelayUrlsAtom);
  const recommendedRelays = useAtomValue(recommendedRelaysAtom);
  const [newRelayUrl, setNewRelayUrl] = useAtom(newRelayUrlAtom);
  const commands = useAtomValue(relayCommandsAtom);
  const isRecommendedRelay = React.useCallback(
    (url: string) => isRecommendedNostrRelay(url, recommendedRelays),
    [recommendedRelays],
  );
  const saveNewRelay = React.useCallback(
    () => commands?.read().saveNewRelay(),
    [commands],
  );
  const requestDeleteSelectedRelay = React.useCallback(
    () => commands?.read().requestDeleteSelectedRelay(),
    [commands],
  );
  return {
    canSaveNewRelay: isRelayUrl(newRelayUrl.trim()),
    isRecommendedRelay,
    newRelayUrl,
    pendingRelayDeleteUrl: useAtomValue(pendingRelayDeleteUrlAtom),
    relayUrls,
    requestDeleteSelectedRelay,
    saveNewRelay,
    selectedRelayUrl:
      route.kind === "nostrRelay" ? route.id.trim() || null : null,
    setNewRelayUrl,
  };
};
