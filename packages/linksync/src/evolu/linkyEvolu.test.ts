import { createIdFromString, createStore, Millis, Name } from "@evolu/common";
import {
  evoluSchemaToSqliteSchema,
  type SyncState,
} from "@evolu/common/local-first";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { appOwnerFromMnemonic } from "../core";
import { LinkySchema, linkyScopes } from "../model";
import { memoryKeyValueStorage } from "../testing/keyValueStorage";
import {
  generateDbNameFromMnemonic,
  openLinkyStore,
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
  it("indexes every table's id and the proof columns the wallet filters on", () => {
    expect(
      evoluSchemaToSqliteSchema(LinkyEvoluSchema, linkyIndexes)
        .indexes.map((index) => index.sql)
        .filter((sql) => !sql.includes(`"evolu_`)),
    ).toEqual([
      ...Object.keys(LinkySchema).map(
        (table) => `create index "${table}Id" on "${table}" ("id")`,
      ),
      'create index "cashuProofState" on "cashuProof" ("state")',
      'create index "cashuProofOperationId" on "cashuProof" ("operationId")',
      'create index "cashuProofKeysetCreatedSecond" on "cashuProof" ("keysetId", substr("createdAt", 1, 19), "mint")',
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
});
