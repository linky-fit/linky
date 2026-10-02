import {
  isPubkey,
  type FetchedMuteList,
  type Pubkey,
} from "@linky-fit/linkstr";
import { Schema } from "effect";
import { BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY } from "../../utils/constants";
import {
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageSet,
  safeLocalStorageSetJson,
} from "../../utils/storage";

const muteListMergedKey = (pubkey: string): string =>
  `linky.mute_list_merged.v1:${pubkey}`;

/** Whether this device has merged the identity's mute list into its block list before. */
export const hasMergedMuteList = (pubkey: string): boolean =>
  safeLocalStorageGet(muteListMergedKey(pubkey)) === "1";

export const recordMuteListMerged = (pubkey: string): void =>
  safeLocalStorageSet(muteListMergedKey(pubkey), "1");

const toPubkey = (value: string): Pubkey | null => {
  const normalized = value.trim().toLowerCase();
  return isPubkey(normalized) ? normalized : null;
};

export const readBlockList = (): ReadonlyArray<Pubkey> => [
  ...new Set(
    safeLocalStorageGetJson(
      BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY,
      Schema.Array(Schema.String),
      [],
    ).flatMap((entry) => toPubkey(entry) ?? []),
  ),
];

export const isBlockedPubkey = (pubkey: string): boolean => {
  const normalized = toPubkey(pubkey);
  return normalized !== null && readBlockList().includes(normalized);
};

const writeBlockList = (blockList: ReadonlyArray<Pubkey>): void =>
  safeLocalStorageSetJson(BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY, blockList);

export const blockPubkey = (pubkey: Pubkey): void => {
  const blockList = readBlockList();
  if (!blockList.includes(pubkey)) writeBlockList([...blockList, pubkey]);
};

export interface MuteListMerge {
  readonly blockList: ReadonlyArray<Pubkey>;
  readonly added: ReadonlyArray<Pubkey>;
  /** The merged list holds entries the published one lacks. */
  readonly publish: boolean;
}

/**
 * The union of the local block list and the published mute list: there is no
 * unblock, so an entry on either side stays blocked. `remote` is null when
 * every relay answered and none holds a list.
 */
export const mergeMuteList = (
  local: ReadonlyArray<Pubkey>,
  remote: FetchedMuteList | null,
): MuteListMerge => {
  const published = remote?.pubkeys ?? [];
  const blockList = [...new Set([...local, ...published])];
  return {
    blockList,
    added: blockList.filter((pubkey) => !local.includes(pubkey)),
    publish: blockList.some((pubkey) => !published.includes(pubkey)),
  };
};

/** Merges the mute list into the stored block list; returns what changed. */
export const adoptMuteList = (
  remote: FetchedMuteList | null,
): MuteListMerge => {
  const merge = mergeMuteList(readBlockList(), remote);
  if (merge.added.length > 0) writeBlockList(merge.blockList);
  return merge;
};
