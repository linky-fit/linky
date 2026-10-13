import {
  createConsole,
  createRandomBytes,
  createTime,
  type EvoluConfig,
  type EvoluDeps,
} from "@evolu/common";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { appOwnerFromMnemonic } from "../core";
import { linkyScopes } from "../model";
import { memoryKeyValueStorage } from "../testing/keyValueStorage";
import type { WorkerMessage } from "./dbWorker";
import {
  createLinkyEvolu,
  generateDbNameFromMnemonic,
  LinkyEvoluSchema,
  openLinkyStore,
  type LinkyEvoluEvent,
} from "./linkyEvolu";

const evoluMock = vi.hoisted(() => {
  const state: {
    calls: Array<{ schema: unknown; config: unknown }>;
    instance: object;
    /** Returns the instance without starting a worker, as Evolu does for a name it already opened. */
    cached: boolean;
  } = { calls: [], instance: {}, cached: false };
  return state;
});
// Plays Evolu: records what it was opened with and starts the database worker.
vi.mock("@evolu/common", async (importOriginal) => {
  const original = await importOriginal<typeof import("@evolu/common")>();
  return {
    ...original,
    createEvolu:
      (deps: EvoluDeps) => (schema: unknown, config: EvoluConfig) => {
        evoluMock.calls.push({ schema, config });
        if (evoluMock.cached) return evoluMock.instance;
        deps
          .createDbWorker(config.name ?? original.SimpleName.orThrow("evolu"))
          .onMessage(() => {});
        return evoluMock.instance;
      },
  };
});

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const appOwner = appOwnerFromMnemonic(mnemonic);
if (!appOwner) throw new Error("invalid test mnemonic");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const transports = [{ type: "WebSocket" as const, url: "wss://a.test" }];

/** Opens the database over a worker the test speaks for. */
const open = (
  mnemonicGiven: string | null,
  onEvent?: (event: LinkyEvoluEvent) => void,
) => {
  evoluMock.calls.length = 0;
  let deliver: (message: WorkerMessage) => void = () => {};
  const opened = createLinkyEvolu({
    evoluDeps: {
      console: createConsole(),
      randomBytes: createRandomBytes(),
      time: createTime(),
      reloadApp: () => {},
    },
    createWorker: () => ({
      postMessage: () => {},
      onMessage: (callback) => {
        deliver = callback;
      },
    }),
    mnemonic: mnemonicGiven,
    transports,
    inMemory: true,
    enableLogging: false,
    ...(onEvent ? { onEvent } : {}),
  });
  return {
    ...opened,
    call: evoluMock.calls[0],
    deliver: (message: WorkerMessage) => deliver(message),
  };
};

describe("generateDbNameFromMnemonic", () => {
  // Existing databases are opened by these names; they must never change.
  it.each([
    [null, "linky-anon"],
    ["", "linky-anon"],
    [mnemonic, "linky-4cc788f4"],
    [
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
      "linky-7584d1ad",
    ],
    ["zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong", "linky-2e70dad5"],
    ["a", "linky-00000061"],
    ["not a mnemonic", "linky-51eea10e"],
    ["příliš žluťoučký kůň", "linky-27ba1f9f"],
  ])("names the database of %j %j", (input, expected) => {
    expect(generateDbNameFromMnemonic(input)).toBe(expected);
  });
});

describe("createLinkyEvolu", () => {
  it("opens the mnemonic's database owned by its app owner", () => {
    const { call } = open(mnemonic);
    expect(call.schema).toBe(LinkyEvoluSchema);
    expect(call.config).toEqual({
      name: "linky-4cc788f4",
      transports,
      enableLogging: false,
      inMemory: true,
      externalAppOwner: appOwner,
    });
  });

  it("lets Evolu create its own owner without a mnemonic", () => {
    const { call } = open(null);
    expect(call.config).toEqual({
      name: "linky-anon",
      transports,
      enableLogging: false,
      inMemory: true,
    });
  });

  it("keeps the running database's owner sync when Evolu hands back the instance it already opened", () => {
    evoluMock.instance = {};
    const first = open(mnemonic);
    evoluMock.cached = true;
    try {
      const again = open(mnemonic);
      expect(again.evolu).toBe(first.evolu);
      expect(again.ownerSync).toBe(first.ownerSync);
      first.deliver({ type: "linksync.ownersSynced", ownerIds: [appOwner.id] });
      expect(again.ownerSync.syncedOwners().has(appOwner.id)).toBe(true);
    } finally {
      evoluMock.cached = false;
    }
  });

  it("reports the relay protocol errors the worker hears", () => {
    const events: LinkyEvoluEvent[] = [];
    const { deliver } = open(mnemonic, (event) => events.push(event));
    const failure = {
      type: "linksync.ownerSyncFailed",
      ownerId: appOwner.id,
      error: "QuotaError",
      endsRound: true,
    } as const;
    deliver(failure);
    expect(events).toEqual([{ _tag: "OwnerSyncFailed", failure }]);
  });
});

describe("openLinkyStore", () => {
  it("reports the subscribed owners, then hydration, and retains per app owner", async () => {
    // An empty local database.
    evoluMock.instance = {
      appOwner: Promise.resolve(appOwner),
      useOwner: () => () => {},
      createQuery: () => "query",
      loadQuery: () => Promise.resolve([]),
      subscribeQuery: () => () => () => {},
    };
    const { evolu, ownerSync, deliver } = open(mnemonic);
    const kv = memoryKeyValueStorage();
    const events: LinkyEvoluEvent[] = [];
    const store = await openLinkyStore(evolu, ownerSync, {
      kv,
      scopes: linkyScopes,
      hasEvoluRelay: true,
      onEvent: (event) => events.push(event),
    });
    await settle();
    const owners = (await Effect.runPromise(store.syncOwners())).map(
      ({ id }) => id,
    );
    expect(owners[0]).toBe(appOwner.id);
    expect(events).toEqual([
      { _tag: "ShardsSubscribed", reason: "boot", owners },
    ]);

    deliver({ type: "linksync.ownersSynced", ownerIds: owners });
    await settle();
    expect(events.at(-1)).toEqual({ _tag: "AccountHydrated", owners });
    expect(
      kv.getItem(`linky.shards.retainedFrom.${appOwner.id}.messages`),
    ).toBe("0");
  });
});
