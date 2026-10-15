import { decodeNpub, encodeNprofile } from "@linky-fit/linkstr";
import { linkstrConfigAtom, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";

/** The user's nprofile for payment requests, naming the relays the app reads from. */
export const useOwnNprofile = (currentNpub: string | null): string | null => {
  const readRelays = useAtomValue(linkstrConfigAtom)?.readRelays;
  return React.useMemo(() => {
    const pubkey = decodeNpub(currentNpub ?? "");
    return pubkey && readRelays ? encodeNprofile(pubkey, readRelays) : null;
  }, [currentNpub, readRelays]);
};
