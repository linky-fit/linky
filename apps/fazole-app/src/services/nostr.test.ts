import { RelayUrl, type SignedPlainEvent } from "@linky-fit/linkstr";
import { makeIdentity, stubPlainTransport } from "@linky-fit/linkstr/testing";
import { Effect } from "effect";
import { finalizeEvent } from "nostr-tools";
import { afterEach, describe, expect, it } from "vitest";
import { createNostr } from "./nostr";
import { makeLinkstrRuntime, type LinkstrRuntime } from "./runtimes";
import { sharedOutboxStore } from "./testing/fakes";

const relays = [RelayUrl.make("wss://relay.test")];
let runtime: LinkstrRuntime | null = null;

afterEach(async () => {
  await runtime?.dispose();
  runtime = null;
});

const publishedProfile = async (
  shop: {
    readonly name: string;
    readonly picture: string | null;
  },
  /** The kind-0 content the relays hold already; none when omitted. */
  existing?: Record<string, string>,
) => {
  const published: SignedPlainEvent[] = [];
  const outboxStore = sharedOutboxStore();
  const { secretKey, pubkey } = makeIdentity();
  runtime = makeLinkstrRuntime({
    secretKey,
    relays,
    allowInsecureLocalhostRelays: false,
    transport: stubPlainTransport(published, () => true, {
      fetch: (_relay, filter) =>
        Effect.succeed(
          existing !== undefined && filter.kinds?.includes(0) === true
            ? [
                finalizeEvent(
                  {
                    kind: 0,
                    created_at: 1_700_000_000,
                    tags: [],
                    content: JSON.stringify(existing),
                  },
                  secretKey,
                ),
              ]
            : [],
        ),
    }),
    outboxStore,
  });
  await createNostr({ runtime, pubkey, relays, outboxStore }).publishProfile(
    shop,
  );
  expect(published.map((event) => event.kind)).toContain(0);
  const content: unknown = JSON.parse(published.at(-1)!.content);
  return content;
};

describe("the shop's Nostr profile", () => {
  it("names the shop and shows its picture", async () => {
    expect(
      await publishedProfile({
        name: "Kavárna",
        picture: "https://blossom.primal.net/ab12.webp",
      }),
    ).toEqual({
      name: "Kavárna",
      display_name: "Kavárna",
      picture: "https://blossom.primal.net/ab12.webp",
    });
  });

  it("keeps the fields Linky set on the profile, such as the lightning address", async () => {
    expect(
      await publishedProfile(
        { name: "Kavárna", picture: null },
        {
          name: "kokos",
          picture: "https://blossom.primal.net/old.jpg",
          lud16: "kokos@linky.fit",
          about: "Coffee",
        },
      ),
    ).toEqual({
      name: "Kavárna",
      display_name: "Kavárna",
      lud16: "kokos@linky.fit",
      about: "Coffee",
    });
  });

  it("leaves the picture out when the shop has none", async () => {
    expect(await publishedProfile({ name: "Kavárna", picture: null })).toEqual({
      name: "Kavárna",
      display_name: "Kavárna",
    });
  });
});
