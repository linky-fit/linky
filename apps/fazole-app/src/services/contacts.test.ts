import { encodeNpub, parsePubkey } from "@linky-fit/linkstr";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { resolveContact, type FetchNip05 } from "./contacts";

const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const pubkey = parsePubkey(hex);
if (pubkey === null) throw new Error("test pubkey");

const linkyFit: FetchNip05 = async (url) => {
  const name = new URL(url).searchParams.get("name");
  return name === "hynek" ? { names: { hynek: hex } } : null;
};

describe("resolveContact", () => {
  it("finds a Linky name on linky.fit and keeps the address", async () => {
    const urls: string[] = [];
    const resolved = await resolveContact("hynek", {
      fetchNip05: (url, signal) => {
        urls.push(url);
        return linkyFit(url, signal);
      },
    });
    expect(resolved).toEqual(
      Result.succeed({ pubkey, address: "hynek@linky.fit" }),
    );
    expect(urls).toEqual([
      "https://linky.fit/.well-known/nostr.json?name=hynek",
    ]);
  });

  it("takes an npub without a lookup", async () => {
    const resolved = await resolveContact(encodeNpub(pubkey), {
      fetchNip05: () => Promise.reject(new Error("no lookup")),
    });
    expect(resolved).toEqual(Result.succeed({ pubkey, address: null }));
  });

  it("tells an unknown name from a domain that does not answer, and nonsense from both", async () => {
    expect(await resolveContact("nobody", { fetchNip05: linkyFit })).toEqual(
      Result.fail("not-found"),
    );
    expect(
      await resolveContact("hynek", {
        fetchNip05: () => Promise.reject(new TypeError("offline")),
      }),
    ).toEqual(Result.fail("unreachable"));
    expect(await resolveContact("a@b@c", { fetchNip05: linkyFit })).toEqual(
      Result.fail("invalid"),
    );
  });
});
