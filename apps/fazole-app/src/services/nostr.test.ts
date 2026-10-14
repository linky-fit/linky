import { RelayUrl, type SignedPlainEvent } from "@linky-fit/linkstr";
import { makeIdentity, stubPlainTransport } from "@linky-fit/linkstr/testing";
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

const publishedProfile = async (shop: {
  readonly name: string;
  readonly picture: string | null;
}) => {
  const published: SignedPlainEvent[] = [];
  const outboxStore = sharedOutboxStore();
  const { secretKey, pubkey } = makeIdentity();
  runtime = makeLinkstrRuntime({
    secretKey,
    relays,
    allowInsecureLocalhostRelays: false,
    transport: stubPlainTransport(published),
    outboxStore,
  });
  await createNostr({ runtime, pubkey, relays, outboxStore }).publishProfile(
    shop,
  );
  expect(published.map((event) => event.kind)).toEqual([0]);
  const content: unknown = JSON.parse(published[0]!.content);
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

  it("leaves the picture out when the shop has none", async () => {
    expect(await publishedProfile({ name: "Kavárna", picture: null })).toEqual({
      name: "Kavárna",
      display_name: "Kavárna",
    });
  });
});
