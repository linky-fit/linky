import { Option, Schema } from "effect";
import {
  PENDING_DEEP_LINK_TEXT_STORAGE_KEY,
  PENDING_DEEP_LINKS_STORAGE_KEY,
} from "../../utils/constants";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../utils/storage";

const decodeLinks = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

/**
 * The queue after a release build may have run in between: the release
 * reads and writes only the single-link key, so that key decides the head.
 * Equal to the head: unchanged. Gone: the release handled or cancelled the
 * head. Another link: the release replaced the head with it.
 */
export const reconcilePendingDeepLinks = (
  queue: readonly string[] | null,
  single: string | null,
): readonly string[] => {
  if (queue === null) return single ? [single] : [];
  if (queue[0] === single) return queue;
  if (!single) return queue.slice(1);
  return [single, ...queue.slice(1)];
};

/** The deep links waiting to be handled, oldest first. */
export const readPendingDeepLinks = (): readonly string[] => {
  const queue = Option.getOrNull(
    decodeLinks(safeLocalStorageGet(PENDING_DEEP_LINKS_STORAGE_KEY)),
  );
  const single =
    (safeLocalStorageGet(PENDING_DEEP_LINK_TEXT_STORAGE_KEY) ?? "").trim() ||
    null;
  const links = reconcilePendingDeepLinks(queue, single);
  if (links !== queue) writePendingDeepLinks(links);
  return links;
};

/**
 * Stores the queue, and its first link under the single-link key, which a
 * build rolled back to the last release still reads.
 */
export const writePendingDeepLinks = (links: readonly string[]): void => {
  const [first] = links;
  if (first === undefined) {
    safeLocalStorageRemove(PENDING_DEEP_LINKS_STORAGE_KEY);
    safeLocalStorageRemove(PENDING_DEEP_LINK_TEXT_STORAGE_KEY);
    return;
  }
  safeLocalStorageSet(PENDING_DEEP_LINKS_STORAGE_KEY, JSON.stringify(links));
  safeLocalStorageSet(PENDING_DEEP_LINK_TEXT_STORAGE_KEY, first);
};

export const appendPendingDeepLink = (link: string): readonly string[] => {
  const links = [...readPendingDeepLinks(), link];
  writePendingDeepLinks(links);
  return links;
};

/** Drops the first stored copy of `link`, once it has been handled. */
export const removePendingDeepLink = (link: string): readonly string[] => {
  const links = [...readPendingDeepLinks()];
  const index = links.indexOf(link);
  if (index >= 0) links.splice(index, 1);
  writePendingDeepLinks(links);
  return links;
};
