import {
  createAppOwner,
  createOwnerSecret,
  createRandomBytes,
} from "@evolu/common";
import {
  createLinkyStore,
  linkyTableColumns,
  makeInMemoryShardDb,
  type LinkyDbSchema,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEAVY_ACCOUNT,
  parseSeedArgs,
  scaleAccountHistory,
  seedAccountHistory,
} from "./seedAccountHistory";

const makeTestStore = () => {
  const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
  const appOwner = createAppOwner(
    createOwnerSecret({ randomBytes: createRandomBytes() }),
  );
  const store = createLinkyStore(db, appOwner);
  return { db, store };
};

describe("scaleAccountHistory", () => {
  it("preserves counts at scale 1 and scales proportionally below 1", () => {
    expect(scaleAccountHistory(DEFAULT_HEAVY_ACCOUNT, 1)).toEqual(
      DEFAULT_HEAVY_ACCOUNT,
    );
    expect(scaleAccountHistory(DEFAULT_HEAVY_ACCOUNT, 0.25)).toEqual({
      contacts: 10,
      contactShards: 1,
      cashuSends: 143,
      messages: 750,
      transactions: 650,
    });
  });

  it("clamps non-zero counts to at least 1 for small positive scales and zeroes all at 0", () => {
    expect(scaleAccountHistory(DEFAULT_HEAVY_ACCOUNT, 0.0001)).toEqual({
      contacts: 1,
      contactShards: 1,
      cashuSends: 1,
      messages: 1,
      transactions: 1,
    });
    expect(scaleAccountHistory(DEFAULT_HEAVY_ACCOUNT, 0)).toEqual({
      contacts: 0,
      contactShards: 0,
      cashuSends: 0,
      messages: 0,
      transactions: 0,
    });
  });

  it("rejects negative or non-finite scales", () => {
    expect(() => scaleAccountHistory(DEFAULT_HEAVY_ACCOUNT, -1)).toThrow();
    expect(() =>
      scaleAccountHistory(DEFAULT_HEAVY_ACCOUNT, Number.NaN),
    ).toThrow();
  });
});

describe("parseSeedArgs", () => {
  it("returns the default heavy account when no flags are passed", () => {
    expect(parseSeedArgs([])).toEqual({
      help: false,
      counts: DEFAULT_HEAVY_ACCOUNT,
    });
  });

  it("scales defaults and lets explicit flags override individual counts", () => {
    expect(
      parseSeedArgs([
        "--scale",
        "0.5",
        "--cashu-sends",
        "100",
        "--contacts",
        "12",
        "--contact-shards",
        "3",
      ]),
    ).toEqual({
      help: false,
      counts: {
        contacts: 12,
        contactShards: 3,
        cashuSends: 100,
        messages: 1_500,
        transactions: 1_300,
      },
    });
  });

  it("clamps contactShards to contacts and returns help when requested", () => {
    expect(
      parseSeedArgs(["--contacts", "2", "--contact-shards", "10"]).counts,
    ).toMatchObject({ contacts: 2, contactShards: 2 });
    expect(parseSeedArgs(["--contacts", "0"]).counts).toMatchObject({
      contacts: 0,
      contactShards: 0,
    });
    expect(parseSeedArgs(["--help"]).help).toBe(true);
  });

  it("rejects unknown flags and invalid numbers", () => {
    expect(() => parseSeedArgs(["--bogus"])).toThrow("unknown option");
    expect(() => parseSeedArgs(["--messages", "-5"])).toThrow(
      "non-negative integer",
    );
    expect(() => parseSeedArgs(["--scale", "abc"])).toThrow(
      "finite non-negative number",
    );
  });
});

describe("seedAccountHistory", () => {
  it("populates and rotates contacts, messages, transactions and cashu shards", async () => {
    const { db, store } = makeTestStore();
    const summary = await seedAccountHistory(store, db.mutate, {
      mint: "http://localhost:3338",
      keysetId: "00ad268c4d1f5826",
      contacts: 6,
      contactShards: 3,
      cashuSends: 32,
      messages: 310,
      transactions: 420,
    });

    expect(summary.shards).toEqual({
      contacts: 3,
      messages: 3,
      transactions: 3,
      cashu: 3,
    });
    expect(summary.rows).toEqual({
      contacts: 6,
      conversations: 6,
      messages: 310,
      transactions: 420,
      cashuOperations: 32,
      cashuProofs: 160,
    });

    const [
      contacts,
      conversations,
      messages,
      transactions,
      operations,
      proofs,
      syncOwners,
    ] = await Promise.all([
      Effect.runPromise(store.rows("contacts", "contact")),
      Effect.runPromise(store.rows("messages", "conversation")),
      Effect.runPromise(store.rows("messages", "message")),
      Effect.runPromise(store.rows("transactions", "transaction")),
      Effect.runPromise(store.rows("cashu", "cashuOperation")),
      Effect.runPromise(store.rows("cashu", "cashuProof")),
      Effect.runPromise(store.syncOwners()),
    ]);

    expect(contacts).toHaveLength(6);
    expect(new Set(contacts.map((row) => row.ownerId)).size).toBe(3);
    expect(contacts.every((row) => row.npub?.startsWith("npub1"))).toBe(true);

    expect(conversations).toHaveLength(6);
    const activeMessagesOwner = store.shardOwner("messages", 2).id;
    expect(
      conversations.every((row) => row.ownerId === activeMessagesOwner),
    ).toBe(true);

    expect(messages).toHaveLength(310);
    expect(new Set(messages.map((row) => row.ownerId)).size).toBe(3);

    expect(transactions).toHaveLength(420);
    expect(new Set(transactions.map((row) => row.ownerId)).size).toBe(3);

    expect(operations).toHaveLength(32);
    expect(proofs).toHaveLength(160);
    expect(proofs.every((row) => row.state === "spent")).toBe(true);
    expect(new Set(proofs.map((row) => row.ownerId)).size).toBe(3);

    expect(summary.syncOwners).toBe(syncOwners.length);
    // 1 app + 1 identity + 3 contacts + 1 peerListings + 3 messages + 1 unknownSenders + 3 cashu + 3 transactions + 1 onchain = 17
    expect(summary.syncOwners).toBe(17);
  });

  it("writes nothing and leaves shard pointers at 0 when all counts are 0", async () => {
    const { db, store } = makeTestStore();
    const summary = await seedAccountHistory(store, db.mutate, {
      mint: "http://localhost:3338",
      keysetId: "00ad268c4d1f5826",
      contacts: 0,
      contactShards: 0,
      cashuSends: 0,
      messages: 0,
      transactions: 0,
    });

    expect(summary.shards).toEqual({
      contacts: 1,
      messages: 1,
      transactions: 1,
      cashu: 1,
    });
    expect(summary.rows).toEqual({
      contacts: 0,
      conversations: 0,
      messages: 0,
      transactions: 0,
      cashuOperations: 0,
      cashuProofs: 0,
    });
  });
});
