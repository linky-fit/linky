import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheProfileAvatarFromUrl,
  loadCachedProfileAvatarObjectUrl,
  releaseAllAvatarObjectUrls,
  releaseAvatarObjectUrl,
} from "./profileCache";

const TEST_NPUB =
  "npub180cvv07tqw7jwr9wnh4hp24w3wl74x64l0n6ms4qxp2vj8qz9c8sv96q8j";

const OTHER_NPUB =
  "npub1sn0wdenkukak0d9dfczzeacvhkrgz92ak56egt7vdgzn8pv2wfqqhrjdv9";

let created: string[] = [];
let revoked: string[] = [];
let cacheEntries: Map<string, Blob>;

beforeEach(() => {
  created = [];
  revoked = [];
  cacheEntries = new Map();

  // Only the two object-url statics are faked; `new URL(...)` must keep
  // working because profileCache builds its cache-key requests with it.
  let counter = 0;
  URL.createObjectURL ??= () => "";
  URL.revokeObjectURL ??= () => undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    counter += 1;
    const url = `blob:mock/${counter}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revoked.push(url);
  });

  const cache = {
    match: (req: Request) =>
      Promise.resolve(
        cacheEntries.has(req.url)
          ? new Response(cacheEntries.get(req.url))
          : undefined,
      ),
    put: (req: Request, res: Response) =>
      res.blob().then((blob) => {
        cacheEntries.set(req.url, blob);
      }),
    delete: (req: Request) =>
      Promise.resolve(cacheEntries.delete(req.url) || false),
  };
  vi.stubGlobal("caches", { open: () => Promise.resolve(cache) });
});

afterEach(() => {
  releaseAllAvatarObjectUrls();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const seedCachedAvatar = async (npub: string, body: string) => {
  // Body is a plain string: jsdom's Blob lacks .stream(), which undici's
  // Response requires; blobs later served from the cache stub come from
  // res.blob() and are undici-native.
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(body)));
  const url = await cacheProfileAvatarFromUrl(
    npub,
    `${globalThis.location.origin}/avatar.png`,
  );
  expect(url).toBeTruthy();
  return url;
};

describe("avatar object url identity", () => {
  it("hands out one stable object url per npub across repeated loads", async () => {
    await seedCachedAvatar(TEST_NPUB, "avatar-bytes");
    const mintedByCaching = created.length;

    const first = await loadCachedProfileAvatarObjectUrl(TEST_NPUB);
    const second = await loadCachedProfileAvatarObjectUrl(TEST_NPUB);
    const third = await loadCachedProfileAvatarObjectUrl(TEST_NPUB);

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(third).toBe(first);
    // Re-reading a cached avatar must not mint a second object url, because a
    // changed <img> src identity forces the browser to reload the image.
    expect(created.length).toBe(mintedByCaching);
    expect(revoked).toEqual([]);
  });

  it("keeps separate object urls per npub", async () => {
    await seedCachedAvatar(TEST_NPUB, "one");
    await seedCachedAvatar(OTHER_NPUB, "two");

    const a = await loadCachedProfileAvatarObjectUrl(TEST_NPUB);
    const b = await loadCachedProfileAvatarObjectUrl(OTHER_NPUB);

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("revokes the previous url only when the avatar bytes are replaced", async () => {
    await seedCachedAvatar(TEST_NPUB, "old-bytes");
    const first = await loadCachedProfileAvatarObjectUrl(TEST_NPUB);

    const replaced = await seedCachedAvatar(TEST_NPUB, "new-bytes");

    expect(replaced).not.toBe(first);
    expect(revoked).toEqual([first]);
    expect(await loadCachedProfileAvatarObjectUrl(TEST_NPUB)).toBe(replaced);
  });

  it("releases a single npub without touching the others", async () => {
    const a = await seedCachedAvatar(TEST_NPUB, "one");
    const b = await seedCachedAvatar(OTHER_NPUB, "two");

    releaseAvatarObjectUrl(TEST_NPUB);

    expect(revoked).toEqual([a]);
    expect(await loadCachedProfileAvatarObjectUrl(OTHER_NPUB)).toBe(b);
    // The released npub re-mints from CacheStorage instead of reviving the url.
    expect(await loadCachedProfileAvatarObjectUrl(TEST_NPUB)).not.toBe(a);
  });

  it("releases every npub on identity change", async () => {
    const a = await seedCachedAvatar(TEST_NPUB, "one");
    const b = await seedCachedAvatar(OTHER_NPUB, "two");

    releaseAllAvatarObjectUrls();

    expect(new Set(revoked)).toEqual(new Set([a, b]));

    // A later load re-mints from CacheStorage rather than resurrecting state.
    const reloaded = await loadCachedProfileAvatarObjectUrl(TEST_NPUB);
    expect(reloaded).toBeTruthy();
    expect(reloaded).not.toBe(a);
  });
});
