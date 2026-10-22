import {
  OutboxStore,
  ProfileMetadata,
  Profiles,
  RelayUrl,
} from "@linky-fit/linkstr";
import {
  makeIdentity,
  stubPlainTransport,
  type SignedPlainEvent,
} from "@linky-fit/linkstr/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createNostr } from "./nostr";
import { makeLinkstrRuntime } from "./runtimes";

const relay = RelayUrl.make("wss://relay.test");

/** A Nostr over one relay that stores every published event and serves the stored ones. */
const setup = () => {
  const identity = makeIdentity();
  const published: SignedPlainEvent[] = [];
  const runtime = makeLinkstrRuntime({
    secretKey: identity.secretKey,
    relays: [relay],
    allowInsecureLocalhostRelays: false,
    transport: stubPlainTransport(published, () => true, {
      fetch: (_relay, filter) =>
        Effect.sync(() =>
          published
            .filter((event) => filter.kinds?.includes(event.kind) === true)
            .map((event) => ({
              ...event,
              tags: event.tags.map((t) => [...t]),
            })),
        ),
    }),
    outboxStore: OutboxStore.inMemory,
  });
  const nostr = createNostr({
    runtime,
    pubkey: identity.pubkey,
    relays: [relay],
    outboxStore: OutboxStore.inMemory,
  });
  const profileContent = (): unknown =>
    JSON.parse(published.at(-1)?.content ?? "null");
  return { runtime, nostr, published, profileContent };
};

const picture = "https://blossom.primal.net/ab12.webp";

describe("publishProfile", () => {
  it("publishes a kind 0 profile with the name and picture", async () => {
    const { nostr, published, profileContent } = setup();
    expect(
      await nostr.publishProfile({ name: "On-chain operator", picture }),
    ).toBe(true);
    expect(published.map((event) => event.kind)).toEqual([0]);
    expect(profileContent()).toEqual({ name: "On-chain operator", picture });
  });

  it("keeps the other fields of the newest profile and sets or clears the picture", async () => {
    const { runtime, nostr, profileContent } = setup();
    await runtime.runPromise(
      Effect.flatMap(Profiles, (profiles) =>
        profiles.publishProfile(
          new ProfileMetadata({
            name: "old",
            about: "Transfers sats",
            picture: "https://example.com/old.png",
            extraFields: { website: "https://example.com" },
          }),
        ),
      ),
    );
    expect(
      await nostr.publishProfile({ name: "Dave's transfers", picture }),
    ).toBe(true);
    expect(profileContent()).toEqual({
      name: "Dave's transfers",
      about: "Transfers sats",
      picture,
      website: "https://example.com",
    });
    expect(
      await nostr.publishProfile({ name: "Dave's transfers", picture: null }),
    ).toBe(true);
    expect(profileContent()).toEqual({
      name: "Dave's transfers",
      about: "Transfers sats",
      website: "https://example.com",
    });
  });
});
