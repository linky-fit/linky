import { ProfileMetadata } from "@linky/linkstr";
import { Schema } from "effect";
import {
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "./utils/storage";
import { isHttpUrl } from "./utils/validation";

/**
 * v2 profile caches, keyed by npub. `updatedAt` is the Nostr event
 * `created_at`, so newest-wins survives across sessions: the watch handler
 * ignores facts that are not strictly newer than what is cached here.
 */

const PROFILE_PREFIX = "linky_nostr_profile_v2:";
const STATUS_PREFIX = "linky_nostr_status_v2:";

const CachedProfile = Schema.Struct({
  metadata: ProfileMetadata,
  updatedAt: Schema.Number,
});
type CachedProfile = typeof CachedProfile.Type;

const CachedStatus = Schema.Struct({
  /** Raw kind-30315 content; empty string means the status was cleared. */
  content: Schema.String,
  updatedAt: Schema.Number,
});
type CachedStatus = typeof CachedStatus.Type;

export const loadCachedProfile = (npub: string): CachedProfile | null =>
  safeLocalStorageGetJson(
    PROFILE_PREFIX + npub,
    Schema.NullOr(CachedProfile),
    null,
  );

export const saveCachedProfile = (
  npub: string,
  metadata: ProfileMetadata,
  updatedAt: number,
): void => {
  safeLocalStorageSetJson(PROFILE_PREFIX + npub, { metadata, updatedAt });
};

export const loadCachedStatus = (npub: string): CachedStatus | null =>
  safeLocalStorageGetJson(
    STATUS_PREFIX + npub,
    Schema.NullOr(CachedStatus),
    null,
  );

export const saveCachedStatus = (
  npub: string,
  content: string,
  updatedAt: number,
): void => {
  safeLocalStorageSetJson(STATUS_PREFIX + npub, { content, updatedAt });
};

const isDataImageUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== "data:") return false;
    return /^image\/(?:jpeg|jpg|png|webp|gif);base64,/i.test(url.pathname);
  } catch {
    return false;
  }
};

export const isDisplayableProfilePictureUrl = (
  value: unknown,
): value is string => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isHttpUrl(trimmed) || isDataImageUrl(trimmed);
};

export const getProfilePictureUrl = (
  metadata: ProfileMetadata | null | undefined,
): string | null => {
  const picture = metadata?.picture;
  return isDisplayableProfilePictureUrl(picture) ? picture.trim() : null;
};

// Avatar blobs live in CacheStorage so they render offline; keyed by npub.

const AVATAR_CACHE_NAME = "linky_nostr_avatar_cache_v1";

const getCurrentOrigin = (): string | null => {
  try {
    const origin = globalThis.location?.origin;
    if (typeof origin !== "string") return null;
    const trimmed = origin.trim();
    return trimmed || null;
  } catch {
    return null;
  }
};

const canUseCacheStorage = (): boolean => {
  try {
    return typeof caches !== "undefined" && typeof Request !== "undefined";
  } catch {
    return false;
  }
};

const makeAvatarCacheRequest = (npub: string): Request | null => {
  try {
    const origin = getCurrentOrigin();
    if (!origin) return null;
    const url = new URL(
      `/__linky_cache/nostr_avatar/${encodeURIComponent(npub)}`,
      origin,
    );
    return new Request(url.toString());
  } catch {
    return null;
  }
};

const canFetchAvatarAsBlob = (avatarUrl: string): boolean => {
  // Fetching cross-origin images as blobs requires permissive CORS headers.
  // Many image hosts block this; those avatars render via <img src> only.
  try {
    const url = new URL(avatarUrl);
    const origin = getCurrentOrigin();
    if (origin && url.origin === origin) return true;
    // Used for deterministic default avatars.
    return url.hostname.toLowerCase() === "api.dicebear.com";
  } catch {
    return false;
  }
};

/**
 * Single owner of avatar `blob:` URL lifetime, one live URL per npub.
 * Re-loading a cached avatar returns the URL already handed out — a changed
 * <img> src identity would force the browser to reload the image — and a URL
 * is revoked only when its avatar bytes are replaced or released.
 */
const avatarObjectUrlByNpub = new Map<string, string>();

const revokeObjectUrl = (url: string): void => {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
};

const registerAvatarObjectUrl = (npub: string, blob: Blob): string => {
  const url = URL.createObjectURL(blob);
  const previous = avatarObjectUrlByNpub.get(npub);
  if (previous !== undefined && previous !== url) revokeObjectUrl(previous);
  avatarObjectUrlByNpub.set(npub, url);
  return url;
};

export const releaseAvatarObjectUrl = (npub: string): void => {
  const trimmed = npub.trim();
  const url = avatarObjectUrlByNpub.get(trimmed);
  if (url === undefined) return;
  revokeObjectUrl(url);
  avatarObjectUrlByNpub.delete(trimmed);
};

export const releaseAllAvatarObjectUrls = (): void => {
  for (const url of avatarObjectUrlByNpub.values()) revokeObjectUrl(url);
  avatarObjectUrlByNpub.clear();
};

export const loadCachedProfileAvatarObjectUrl = async (
  npub: string,
): Promise<string | null> => {
  const trimmed = npub.trim();
  if (!trimmed || !canUseCacheStorage()) return null;

  const existing = avatarObjectUrlByNpub.get(trimmed);
  if (existing !== undefined) return existing;

  const req = makeAvatarCacheRequest(trimmed);
  if (!req) return null;

  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    const match = await cache.match(req);
    if (!match) return null;
    const blob = await match.blob();
    if (!blob || blob.size <= 0) return null;
    // A concurrent load may have registered while this one awaited.
    return (
      avatarObjectUrlByNpub.get(trimmed) ??
      registerAvatarObjectUrl(trimmed, blob)
    );
  } catch {
    return null;
  }
};

export const cacheProfileAvatarFromUrl = async (
  npub: string,
  avatarUrl: string,
): Promise<string | null> => {
  const trimmed = npub.trim();
  if (!trimmed) return null;
  if (!isHttpUrl(avatarUrl)) return null;
  if (!canFetchAvatarAsBlob(avatarUrl)) return null;
  if (!canUseCacheStorage()) return null;

  const req = makeAvatarCacheRequest(trimmed);
  if (!req) return null;

  try {
    const res = await fetch(avatarUrl);
    if (!res.ok) return null;

    const cache = await caches.open(AVATAR_CACHE_NAME);
    await cache.put(req, res.clone());

    const blob = await res.blob();
    if (!blob || blob.size <= 0) return null;
    return registerAvatarObjectUrl(trimmed, blob);
  } catch {
    return null;
  }
};

export const deleteCachedProfileAvatar = async (
  npub: string,
): Promise<void> => {
  const trimmed = npub.trim();
  if (!trimmed) return;
  releaseAvatarObjectUrl(trimmed);
  if (!canUseCacheStorage()) return;
  const req = makeAvatarCacheRequest(trimmed);
  if (!req) return;

  try {
    const cache = await caches.open(AVATAR_CACHE_NAME);
    await cache.delete(req);
  } catch {
    // ignore
  }
};
