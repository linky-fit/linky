import { KeyValueStore, makeInMemoryKeyValueStore } from "@linky-fit/linkshu";
import { RelayUrl, type SignedPlainEvent } from "@linky-fit/linkstr";
import { stubPlainTransport } from "@linky-fit/linkstr/testing";
import { Effect, Layer } from "effect";
import { finalizeEvent } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readShop, saveShop } from "../storage/shop";
import { createAppServices, type AppServices } from "./appServices";
import {
  memoryKv,
  sharedOutboxStore,
  testAccount,
  testConfig,
  testStore,
} from "./testing/fakes";

const running: AppServices[] = [];
afterEach(async () => {
  for (const services of running.splice(0)) await services.dispose();
});

const PROFILE_AT = 1_700_000_000;

/** Services whose relays hold `profile` as the account's kind 0, if given, over a shop edited at `editedAt`. */
const startedServices = async (
  profile?: Record<string, string>,
  editedAt: number | null = null,
) => {
  const account = testAccount();
  const published: SignedPlainEvent[] = [];
  const services = createAppServices({
    account,
    store: testStore(),
    config: { ...testConfig, nostrRelays: [RelayUrl.make("wss://relay.test")] },
    ports: {
      kv: memoryKv(),
      outboxStore: sharedOutboxStore(),
      keyValueStore: Layer.succeed(KeyValueStore, makeInMemoryKeyValueStore()),
      transport: stubPlainTransport(published, () => true, {
        subscribe: () => Effect.never,
        fetch: (_relay, filter) =>
          Effect.succeed(
            profile !== undefined && filter.kinds?.includes(0) === true
              ? [
                  finalizeEvent(
                    {
                      kind: 0,
                      created_at: PROFILE_AT,
                      tags: [],
                      content: JSON.stringify(profile),
                    },
                    account.secretKey,
                  ),
                ]
              : [],
          ),
      }),
    },
  });
  running.push(services);
  await Effect.runPromise(
    saveShop(
      services.repositories.settings,
      {
        name: "Kavárna",
        iban: null,
        picture: null,
      },
      editedAt,
    ),
  );
  services.start();
  return { services, published };
};

const shopOf = (services: AppServices) =>
  Effect.runPromise(readShop(services.repositories.settings));

describe("the shop's name and picture", () => {
  it("are taken from the account's Nostr profile, which Linky edits too", async () => {
    const { services, published } = await startedServices({
      name: "kokos",
      picture: "https://blossom.primal.net/kokos.jpg",
    });
    await vi.waitFor(async () =>
      expect(await shopOf(services)).toEqual({
        name: "kokos",
        iban: null,
        picture: "https://blossom.primal.net/kokos.jpg",
      }),
    );
    expect(published.filter((event) => event.kind === 0)).toEqual([]);
  });

  it("go out as the profile while the account has none", async () => {
    const { published } = await startedServices();
    await vi.waitFor(() =>
      expect(
        published
          .filter((event) => event.kind === 0)
          .map((event): unknown => JSON.parse(event.content)),
      ).toEqual([{ name: "Kavárna", display_name: "Kavárna" }]),
    );
  });

  it("go out as the profile when the merchant edited them after it was published", async () => {
    const { services, published } = await startedServices(
      { name: "kokos", lud16: "kokos@linky.fit" },
      PROFILE_AT + 60,
    );
    await vi.waitFor(() =>
      expect(
        published
          .filter((event) => event.kind === 0)
          .map((event): unknown => JSON.parse(event.content)),
      ).toEqual([
        { name: "Kavárna", display_name: "Kavárna", lud16: "kokos@linky.fit" },
      ]),
    );
    expect(await shopOf(services)).toMatchObject({ name: "Kavárna" });
  });
});
