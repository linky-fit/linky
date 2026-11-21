import {
  createIdFromString,
  createStore,
  Millis,
  Name,
  ok,
  type EvoluError,
} from "@evolu/common";
import {
  evoluSchemaToSqliteSchema,
  type SyncState,
} from "@evolu/common/local-first";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { appOwnerFromMnemonic } from "../core";
import { linkyScopes } from "../model";
import { memoryKeyValueStorage } from "../testing/keyValueStorage";
import {
  awaitDatabaseReady,
  classifyEvoluOpenError,
  DeviceStorageUnavailableError,
  EvoluDatabaseRefusedError,
  generateDbNameFromMnemonic,
  openLinkyStore,
  syncStateQuotaErrors,
  type LinkyEvoluEvent,
} from "./linkyEvolu";
import { LinkyEvoluSchema, linkyIndexes } from "./linkyEvoluSchema";

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const appOwner = appOwnerFromMnemonic(mnemonic);
if (!appOwner) throw new Error("invalid test mnemonic");
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("generateDbNameFromMnemonic", () => {
  // Evolu 8 finds the Evolu 7 databases by these names; they must never change.
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

describe("appOwnerFromMnemonic", () => {
  it("takes a mnemonic typed with capitals and extra spaces", () => {
    expect(
      appOwnerFromMnemonic(`  ${mnemonic.toUpperCase().replace(/ /g, "  ")} `)
        ?.id,
    ).toBe(appOwner.id);
  });
});

describe("linkyIndexes", () => {
  it("adds only the proof query indexes and leaves id indexes to Evolu 8", () => {
    expect(
      evoluSchemaToSqliteSchema(LinkyEvoluSchema, linkyIndexes).indexes.map(
        (index) => index.sql,
      ),
    ).toEqual([
      'create index "cashuProofState" on "cashuProof" ("state")',
      'create index "cashuProofOperationId" on "cashuProof" ("operationId")',
      'create index "cashuProofKeysetCreatedSecond" on "cashuProof" ("keysetId", substr("createdAt", 1, 19), "mint")',
    ]);
  });
});

describe("awaitDatabaseReady", () => {
  it("rejects promptly when evoluError reports a refusal while the probe is pending", async () => {
    const evoluError = createStore<EvoluError | null>(null);
    const pending = awaitDatabaseReady(
      { loadQuery: () => new Promise(() => {}) },
      evoluError,
    );
    const refusal: EvoluError = {
      type: "DatabaseHeldError",
      name: Name.orThrow("linky-test"),
    };
    evoluError.set(refusal);
    await expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof EvoluDatabaseRefusedError &&
        error.evoluError === refusal,
    );
  });
});

describe("syncStateQuotaErrors", () => {
  it("lists every writable owner with a ProtocolQuotaError route failure", () => {
    const name = Name.orThrow("linky-test");
    const quotaError = {
      type: "ProtocolQuotaError" as const,
      ownerId: appOwner.id,
      at: Millis.orThrow(1),
    };
    const state: SyncState = {
      transports: [],
      tenants: [
        {
          type: "Active",
          name,
          owners: [
            {
              type: "Writable",
              ownerId: appOwner.id,
              routes: [
                {
                  type: "Pending",
                  transportId: createIdFromString<"SyncTransport">("t"),
                  failure: quotaError,
                  skippedError: null,
                  completeAt: null,
                  lastSentAt: null,
                  lastReceivedAt: null,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(syncStateQuotaErrors(state, name)).toEqual([
      { ownerId: appOwner.id, error: quotaError },
    ]);
  });
});

describe("openLinkyStore", () => {
  it("reports the subscribed owners, then hydration, and retains per app owner", async () => {
    const name = Name.orThrow("linky-test");
    const syncState = createStore<SyncState | null>(null);
    // An empty local database.
    const evolu = {
      name,
      appOwner,
      useOwner: () => () => {},
      loadQuery: () => Promise.resolve([]),
      subscribeQuery: () => () => () => {},
      upsert: () => ({}),
      update: () => ({}),
      getMutationSize: () => 1,
      deleteOwner: () => Promise.resolve(ok()),
    };
    const kv = memoryKeyValueStorage();
    const events: LinkyEvoluEvent[] = [];
    const store = await openLinkyStore(evolu, {
      syncState,
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

    syncState.set({
      transports: [],
      tenants: [
        {
          type: "Active",
          name,
          owners: owners.map((ownerId) => ({
            type: "Writable",
            ownerId,
            routes: [
              {
                type: "Pending",
                transportId: createIdFromString<"SyncTransport">("t"),
                failure:
                  ownerId === appOwner.id
                    ? {
                        type: "ProtocolQuotaError",
                        ownerId,
                        at: Millis.orThrow(1),
                      }
                    : null,
                skippedError: null,
                completeAt: Millis.orThrow(1),
                lastSentAt: null,
                lastReceivedAt: null,
              },
            ],
          })),
        },
      ],
    });
    await settle();
    expect(events).toContainEqual({
      _tag: "OwnerSyncFailed",
      ownerId: appOwner.id,
      error: "ProtocolQuotaError",
    });
    expect(events.at(-1)).toEqual({ _tag: "AccountHydrated", owners });
    expect(
      kv.getItem(`linky.shards.retainedFrom.${appOwner.id}.messages`),
    ).toBe("0");
  });

  it("classifies Evolu open failures consistently for recovery screens", () => {
    expect(
      classifyEvoluOpenError(
        new EvoluDatabaseRefusedError({ type: "OtherBuildRunningError" }),
      ),
    ).toBe("otherTab");
    expect(classifyEvoluOpenError(new DeviceStorageUnavailableError())).toBe(
      "storageUnavailable",
    );
    expect(classifyEvoluOpenError(new Error("boom"))).toBe("other");
  });
});
