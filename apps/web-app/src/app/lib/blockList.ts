import {
  isPubkey,
  MuteListChange,
  UnixSeconds,
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
import { nowSeconds } from "../../utils/time";

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

const blockListListeners = new Set<() => void>();

/** Calls `listener` after each write that changes the block list; returns the unsubscribe. */
export const subscribeBlockList = (listener: () => void): (() => void) => {
  blockListListeners.add(listener);
  return () => blockListListeners.delete(listener);
};

const writeBlockList = (blockList: ReadonlyArray<Pubkey>): void => {
  const previous = safeLocalStorageGet(BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY);
  safeLocalStorageSetJson(BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY, blockList);
  if (safeLocalStorageGet(BLOCKED_NOSTR_PUBKEYS_STORAGE_KEY) === previous)
    return;
  for (const listener of blockListListeners) listener();
};

/**
 * A pubkey's newest block or unblock on this device; `at` is 0 for a block
 * older than these records, and `pending` marks a change made here that no
 * relay has confirmed yet.
 */
export interface BlockChange {
  readonly blocked: boolean;
  readonly at: number;
  readonly pending?: boolean | undefined;
}

export type BlockChanges = ReadonlyMap<Pubkey, BlockChange>;

const BLOCK_CHANGES_STORAGE_KEY = "linky.block_list_changes.v1";

const StoredBlockChanges = Schema.Record(
  Schema.String,
  Schema.Struct({
    blocked: Schema.Boolean,
    at: Schema.Number,
    pending: Schema.optional(Schema.Boolean),
  }),
);

export const readBlockChanges = (): BlockChanges => {
  const changes = new Map<Pubkey, BlockChange>();
  const stored = safeLocalStorageGetJson(
    BLOCK_CHANGES_STORAGE_KEY,
    StoredBlockChanges,
    {},
  );
  for (const [key, change] of Object.entries(stored)) {
    const pubkey = toPubkey(key);
    if (pubkey) changes.set(pubkey, change);
  }
  for (const pubkey of readBlockList()) {
    if (!changes.has(pubkey)) changes.set(pubkey, { blocked: true, at: 0 });
  }
  return changes;
};

const isBlockedIn = (changes: BlockChanges, pubkey: Pubkey): boolean =>
  changes.get(pubkey)?.blocked ?? false;

const writeBlockChanges = (changes: BlockChanges): void => {
  safeLocalStorageSetJson(
    BLOCK_CHANGES_STORAGE_KEY,
    Object.fromEntries(changes),
  );
  writeBlockList(
    [...changes.keys()].filter((pubkey) => isBlockedIn(changes, pubkey)),
  );
};

const changeBlock = (pubkey: Pubkey, blocked: boolean): void => {
  const changes = new Map(readBlockChanges());
  const previous = changes.get(pubkey);
  if ((previous?.blocked ?? false) === blocked) return;
  // Dated after the change it replaces, even on a clock that runs behind.
  changes.set(pubkey, {
    blocked,
    at: Math.max(nowSeconds(), (previous?.at ?? 0) + 1),
    pending: true,
  });
  writeBlockChanges(changes);
};

export const blockPubkey = (pubkey: Pubkey): void => changeBlock(pubkey, true);

export const unblockPubkey = (pubkey: Pubkey): void =>
  changeBlock(pubkey, false);

/**
 * The changes a fetched list carries. A list without timed changes comes from
 * another client or an older Linky, so its `p` entries count as blocked when
 * it was signed; in a list with them, a `p` entry without one is a block older
 * than these records. Where a `p` entry and a timed change disagree, another
 * client edited the list, at the latest when it signed it.
 */
const publishedChanges = (remote: FetchedMuteList): BlockChanges => {
  const untimedAt = remote.changes.length === 0 ? remote.createdAt : 0;
  const changes = new Map<Pubkey, BlockChange>();
  for (const change of remote.changes) {
    const listed = remote.pubkeys.includes(change.pubkey);
    changes.set(
      change.pubkey,
      change.muted === listed
        ? { blocked: change.muted, at: change.at }
        : { blocked: listed, at: remote.createdAt },
    );
  }
  for (const pubkey of remote.pubkeys) {
    if (!changes.has(pubkey))
      changes.set(pubkey, { blocked: true, at: untimedAt });
  }
  return changes;
};

export interface MuteListMerge {
  readonly changes: BlockChanges;
  readonly blockList: ReadonlyArray<Pubkey>;
  readonly added: ReadonlyArray<Pubkey>;
  readonly removed: ReadonlyArray<Pubkey>;
  /** The merged changes differ from the published ones. */
  readonly publish: boolean;
}

/**
 * Merges this device's changes with the published list's: per pubkey the
 * later change wins and a tie keeps the block, so lists published
 * concurrently on several devices lose nothing. A block still pending here
 * also beats a later-dated unblock, since a clock running ahead elsewhere
 * must not undo it. `remote` is null when every relay answered and none holds
 * a list.
 */
export const mergeMuteList = (
  local: BlockChanges,
  remote: FetchedMuteList | null,
): MuteListMerge => {
  const published = remote === null ? new Map() : publishedChanges(remote);
  const changes = new Map(local);
  for (const [pubkey, change] of published) {
    const mine = changes.get(pubkey);
    if (mine?.pending && mine.blocked && !change.blocked) {
      if (change.at >= mine.at)
        changes.set(pubkey, { ...mine, at: change.at + 1 });
      continue;
    }
    if (
      !mine ||
      change.at > mine.at ||
      (change.at === mine.at && change.blocked)
    )
      changes.set(pubkey, change);
  }
  const blockList = [...changes.keys()].filter((pubkey) =>
    isBlockedIn(changes, pubkey),
  );
  return {
    changes,
    blockList,
    added: blockList.filter((pubkey) => !isBlockedIn(local, pubkey)),
    removed: [...local.keys()].filter(
      (pubkey) => isBlockedIn(local, pubkey) && !isBlockedIn(changes, pubkey),
    ),
    publish:
      remote === null
        ? changes.size > 0
        : [...changes].some(([pubkey, change]) => {
            const listed = published.get(pubkey);
            return (
              listed === undefined ||
              listed.blocked !== change.blocked ||
              listed.at !== change.at
            );
          }),
  };
};

/** The timed changes to publish; a block from before these records has no time to share. */
export const toMuteListChanges = (
  changes: BlockChanges,
): ReadonlyArray<MuteListChange> =>
  [...changes].flatMap(([pubkey, change]) =>
    change.at > 0
      ? [
          new MuteListChange({
            pubkey,
            muted: change.blocked,
            at: UnixSeconds.make(change.at),
          }),
        ]
      : [],
  );

/**
 * Merges the mute list into the stored block changes; returns the merge. A
 * list that needs no publish holds every change, so none is pending anymore.
 */
export const adoptMuteList = (
  remote: FetchedMuteList | null,
): MuteListMerge => {
  const merge = mergeMuteList(readBlockChanges(), remote);
  writeBlockChanges(
    merge.publish
      ? merge.changes
      : new Map(
          [...merge.changes].map(([pubkey, { blocked, at }]) => [
            pubkey,
            { blocked, at },
          ]),
        ),
  );
  return merge;
};
