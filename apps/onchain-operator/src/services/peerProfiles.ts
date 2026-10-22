import type { ProfileMetadata, Pubkey } from "@linky-fit/linkstr";

/** What a user's kind 0 profile says about them; `null` fields they left empty. */
export interface PeerProfile {
  readonly name: string | null;
  readonly picture: string | null;
}

/** The profiles of the users the screens show, fetched once per session. */
export interface PeerProfiles {
  /** `undefined` until fetched; a user without a profile reads as empty fields. */
  readonly get: (pubkey: Pubkey) => PeerProfile | undefined;
  /** Fetches the profile unless it is fetched or on its way; requests in one tick share a fetch. */
  readonly request: (pubkey: Pubkey) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

const nonBlank = (text: string | undefined): string | null =>
  text === undefined || text.trim() === "" ? null : text.trim();

export const peerProfileOf = (
  metadata: ProfileMetadata | undefined,
): PeerProfile => ({
  name: nonBlank(metadata?.displayName) ?? nonBlank(metadata?.name),
  picture: nonBlank(metadata?.picture),
});

export const createPeerProfiles = (
  fetchProfiles: (
    pubkeys: readonly Pubkey[],
  ) => Promise<ReadonlyMap<Pubkey, ProfileMetadata>>,
): PeerProfiles => {
  const profiles = new Map<Pubkey, PeerProfile>();
  const requested = new Set<Pubkey>();
  const listeners = new Set<() => void>();
  let batch: Pubkey[] = [];

  const flush = async () => {
    const pubkeys = batch;
    batch = [];
    try {
      const fetched = await fetchProfiles(pubkeys);
      for (const pubkey of pubkeys)
        profiles.set(pubkey, peerProfileOf(fetched.get(pubkey)));
      for (const listener of listeners) listener();
    } catch (error) {
      console.warn("[onchain-operator] profiles not fetched", error);
      // A later request, e.g. the next time the screen opens, tries again.
      for (const pubkey of pubkeys) requested.delete(pubkey);
    }
  };

  return {
    get: (pubkey) => profiles.get(pubkey),
    request: (pubkey) => {
      if (requested.has(pubkey)) return;
      requested.add(pubkey);
      batch.push(pubkey);
      if (batch.length === 1) queueMicrotask(() => void flush());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
