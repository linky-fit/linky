import * as Evolu from "@evolu/common";
import type { LegacyTokenRow } from "@linky-fit/linkshu";
import {
  activeNostrIdentityId,
  createId,
  createLinkyStore,
  directConversationIdFor,
  linkyTableColumns,
  makeInMemoryShardDb,
  makeSettingsRepository,
  type LinkyDbSchema,
  type Mutation,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CashuTokenRow,
  LegacyContactRow,
  NostrIdentityRow,
  NostrMessageRow,
  NostrReactionRow,
  OwnerMetaRow,
  TransactionRow,
} from "../../evolu";
import {
  clearLegacyLaneStorage,
  isLaneGracePeriodActive,
  LANE_MIGRATION_GRACE_PERIOD_MS,
  LANE_MIGRATION_RELEASED_AT_MS,
  legacyPointerIndex,
  legacySnapshotKey,
  readLegacyLaneIndexes,
  runLaneToShardMigration,
  type LegacyLaneSnapshot,
} from "./laneToShardMigration";

const owner = (seed: number) =>
  Evolu.createAppOwner(
    Evolu.OwnerSecret.orThrow(new Uint8Array(32).fill(seed)),
  );

const appOwner = owner(1);
const laneA = owner(2);
const laneB = owner(3);
const foreign = owner(9);

const iso = (sec: number) =>
  Evolu.DateIso.orThrow(new Date(sec * 1000).toISOString());

const system = (owner: Evolu.AppOwner, atSec: number) => ({
  ownerId: owner.id,
  createdAt: iso(atSec),
  updatedAt: iso(atSec),
  isDeleted: null,
});

const text = (value: string) => Evolu.NonEmptyString1000.orThrow(value);
const short = (value: string) => Evolu.NonEmptyString100.orThrow(value);
const positive = (value: number) => Evolu.PositiveInt.orThrow(value);

const contact = (
  owner: Evolu.AppOwner,
  overrides: Partial<LegacyContactRow> = {},
): LegacyContactRow => ({
  id: createId<"Contact">(),
  name: null,
  nameSetByUser: null,
  npub: null,
  lnAddress: null,
  lnAddressSetByUser: null,
  groupName: null,
  groupNamesJson: null,
  archivedAtSec: null,
  chatLastSeenAtSec: null,
  chatPeerSeenSinceSec: null,
  chatPeerSeenAtSec: null,
  ...system(owner, 100),
  ...overrides,
});

const message = (
  owner: Evolu.AppOwner,
  contactId: LegacyContactRow["id"],
  overrides: Partial<NostrMessageRow> = {},
): NostrMessageRow => ({
  id: createId<"NostrMessage">(),
  contactId,
  direction: short("in"),
  content: Evolu.NonEmptyString.orThrow("hello"),
  wrapId: text(`wrap-${Math.random()}`),
  rumorId: null,
  pubkey: null,
  createdAtSec: positive(1_700_000_000),
  clientId: null,
  status: null,
  localOnly: null,
  replyToId: null,
  replyToContent: null,
  rootMessageId: null,
  editedAtSec: null,
  editedFromId: null,
  isEdited: null,
  originalContent: null,
  ...system(owner, 110),
  ...overrides,
});

const reaction = (
  owner: Evolu.AppOwner,
  messageId: string,
): NostrReactionRow => ({
  id: createId<"NostrReaction">(),
  messageId: text(messageId),
  reactorPubkey: text("ab".repeat(32)),
  emoji: short("+"),
  createdAtSec: positive(1_700_000_001),
  wrapId: text(`wrap-${Math.random()}`),
  clientId: null,
  status: null,
  ...system(owner, 120),
});

const transaction = (
  owner: Evolu.AppOwner,
  overrides: Partial<TransactionRow> = {},
): TransactionRow => ({
  id: createId<"Transaction">(),
  createdAtSec: positive(1_700_000_000),
  direction: short("out"),
  status: short("ok"),
  amount: positive(21),
  fee: null,
  category: null,
  method: null,
  phase: null,
  note: null,
  detailsJson: null,
  iconKind: null,
  contactId: null,
  mint: null,
  unit: null,
  error: null,
  pendingLabel: null,
  ...system(owner, 130),
  ...overrides,
});

const identity = (
  owner: Evolu.AppOwner,
  nsec: string,
  atSec: number,
): NostrIdentityRow => ({
  id: createId<"NostrIdentity">(),
  nsec: text(nsec),
  npub: null,
  source: short("derived"),
  switchedAtSec: null,
  ...system(owner, atSec),
});

const token = (
  owner: Evolu.AppOwner,
  tokenText: string,
  overrides: Partial<CashuTokenRow> = {},
): CashuTokenRow => ({
  id: createId<"CashuToken">(),
  token: Evolu.NonEmptyString.orThrow(tokenText),
  originalTokenText: null,
  rawToken: null,
  mint: null,
  unit: null,
  amount: null,
  state: null,
  error: null,
  ...system(owner, 140),
  ...overrides,
});

const ownerMeta = (
  owner: Evolu.AppOwner,
  scope: string,
  value: string,
): OwnerMetaRow => ({
  id: createId<"OwnerMeta">(),
  scope: short(scope),
  value: text(value),
  ...system(owner, 150),
});

const emptySnapshot: LegacyLaneSnapshot = {
  contacts: [],
  messages: [],
  reactions: [],
  tokens: [],
  proofs: [],
  operations: [],
  transactions: [],
  identities: [],
  ownerMeta: [],
};

const setup = (dbOptions: { readonly holdSync?: boolean } = {}) => {
  const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns, dbOptions);
  const store = createLinkyStore(db, appOwner);
  const ingestLegacyTokens = vi.fn<
    (rows: ReadonlyArray<LegacyTokenRow>) => Promise<void>
  >(() => Promise.resolve());
  const run = (
    snapshot: Partial<LegacyLaneSnapshot>,
    legacyOwnerIds: ReadonlySet<string> = new Set([
      appOwner.id,
      laneA.id,
      laneB.id,
    ]),
  ) =>
    runLaneToShardMigration({
      store,
      snapshot: { ...emptySnapshot, ...snapshot },
      legacyOwnerIds,
      ingestLegacyTokens,
    });
  const rows = <T extends "contact" | "conversation" | "message" | "reaction">(
    scope: "contacts" | "messages",
    table: T,
  ) => Effect.runSync(store.rows(scope, table));
  return { db, store, ingestLegacyTokens, run, rows };
};

beforeEach(() => {
  localStorage.clear();
});

describe("runLaneToShardMigration", () => {
  it("keeps the archive on the contact and moves the chat state to the conversation", async () => {
    const { run, store } = setup();
    const chatted = contact(laneA, {
      name: text("Alice"),
      chatLastSeenAtSec: positive(1_700_000_050),
      archivedAtSec: positive(1_700_000_060),
    });
    const quiet = contact(laneB, { name: text("Bob") });
    const messaged = contact(laneB, { name: text("Carol") });
    const report = await run({
      contacts: [chatted, quiet, messaged],
      messages: [message(laneA, messaged.id)],
    });

    const contacts = Effect.runSync(store.rows("contacts", "contact"));
    expect(contacts.map((row) => row.name).sort()).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
    expect(Object.keys(contacts[0] ?? {})).not.toContain("chatLastSeenAtSec");
    expect(contacts.find((row) => row.id === chatted.id)?.archivedAtSec).toBe(
      1_700_000_060,
    );

    const conversations = Effect.runSync(
      store.rows("messages", "conversation"),
    );
    expect(conversations).toHaveLength(2);
    const alice = conversations.find(
      (row) => row.id === directConversationIdFor(chatted.id),
    );
    expect(alice).toMatchObject({
      kind: "direct",
      contactId: chatted.id,
      lastSeenAtSec: 1_700_000_050,
      archivedAtSec: 1_700_000_060,
    });
    expect(
      conversations.find(
        (row) => row.id === directConversationIdFor(messaged.id),
      ),
    ).toMatchObject({ contactId: messaged.id, lastSeenAtSec: null });
    expect(report.counts).toContainEqual({
      scope: "messages",
      table: "conversation",
      ingested: 2,
      skipped: 0,
    });
  });

  it("points messages and reactions at the conversation and drops orphan reactions", async () => {
    const { run, rows } = setup();
    const peer = contact(laneA);
    const first = message(laneA, peer.id, { rumorId: text("rumor-1") });
    const report = await run({
      contacts: [peer],
      messages: [first],
      reactions: [reaction(laneB, "rumor-1"), reaction(laneB, "rumor-missing")],
    });

    const [stored] = rows("messages", "message");
    expect(stored).toMatchObject({
      id: first.id,
      conversationId: directConversationIdFor(peer.id),
      content: "hello",
    });
    expect(Object.keys(stored ?? {})).not.toContain("contactId");
    const reactions = rows("messages", "reaction");
    expect(reactions).toHaveLength(1);
    expect(reactions[0]?.conversationId).toBe(directConversationIdFor(peer.id));
    expect(report.counts).toContainEqual({
      scope: "messages",
      table: "reaction",
      ingested: 1,
      skipped: 1,
    });
  });

  it("ignores rows of owners outside the legacy set", async () => {
    const { run, rows } = setup();
    await run({ contacts: [contact(laneA), contact(foreign)] });
    expect(rows("contacts", "contact")).toHaveLength(1);
  });

  it("merges copies of one id across lanes, newest columns winning without erasing older ones", async () => {
    const { run, rows } = setup();
    const id = createId<"Contact">();
    const full = contact(laneA, {
      id,
      name: text("Old name"),
      npub: text("npub1full"),
    });
    const phantom = contact(laneB, {
      id,
      name: text("New name"),
      ...system(laneB, 200),
    });
    await run({ contacts: [phantom, full] });
    const [stored] = rows("contacts", "contact");
    expect(stored).toMatchObject({ name: "New name", npub: "npub1full" });
  });

  it("fills the transaction method from the legacy category and drops the deprecated columns", async () => {
    const { run, store } = setup();
    await run({
      transactions: [
        transaction(laneA, { category: short("contacts") }),
        transaction(laneA, {
          category: short("lightning"),
          phase: short("melt"),
        }),
        transaction(laneA, { method: short("cashu_receive") }),
      ],
    });
    const stored = Effect.runSync(store.rows("transactions", "transaction"));
    expect(stored.map((row) => row.method).sort()).toEqual([
      "cashu_chat",
      "cashu_receive",
      "lightning_invoice",
    ]);
    for (const row of stored) {
      expect(Object.keys(row)).not.toContain("category");
      expect(Object.keys(row)).not.toContain("phase");
    }
  });

  it("writes the newest identity row under the active id", async () => {
    const { run, store } = setup();
    await run({
      identities: [
        identity(laneA, "nsec1older", 100),
        identity(laneB, "nsec1newest", 300),
        identity(appOwner, "nsec1middle", 200),
      ],
    });
    const stored = Effect.runSync(store.rows("identity", "nostrIdentity"));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: activeNostrIdentityId,
      nsec: "nsec1newest",
    });
  });

  it("hands decodable cashuToken rows to linkshu and skips the rest", async () => {
    const { run, ingestLegacyTokens } = setup();
    const report = await run({
      tokens: [
        token(laneA, "cashuAfixture", { state: short("accepted") }),
        token(laneA, "cashuAdeleted", { isDeleted: 1 }),
      ],
    });
    expect(ingestLegacyTokens).toHaveBeenCalledTimes(1);
    const [rows] = ingestLegacyTokens.mock.calls[0] ?? [];
    expect(rows?.map((row) => row.tokenText)).toEqual(["cashuAfixture"]);
    expect(report.counts).toContainEqual({
      scope: "cashu",
      table: "cashuToken",
      ingested: 1,
      skipped: 1,
    });
  });

  it("does not build a linkshu runtime when there are no token rows", async () => {
    const { run, ingestLegacyTokens } = setup();
    await run({});
    expect(ingestLegacyTokens).not.toHaveBeenCalled();
  });

  it("carries the dismissed onboarding flag into settings", async () => {
    const { run, store } = setup();
    await run({
      ownerMeta: [ownerMeta(appOwner, "onboardingTutorial", "dismissed")],
    });
    expect(
      Effect.runSync(makeSettingsRepository(store).get("onboardingTutorial")),
    ).toBe("dismissed");
  });

  it("carries the default mint into settings", async () => {
    const { run, store } = setup();
    await run({
      ownerMeta: [ownerMeta(appOwner, "defaultMint", "https://mint.example")],
    });
    expect(
      Effect.runSync(makeSettingsRepository(store).get("defaultMint")),
    ).toBe("https://mint.example");
  });

  it("is idempotent", async () => {
    const { run } = setup();
    const peer = contact(laneA);
    await run({ contacts: [peer] });
    const second = await run({ contacts: [peer] });
    expect(
      second.counts.find((count) => count.table === "contact")?.ingested,
    ).toBe(0);
  });

  it("waits for hydration before comparing lane rows with the account's shard copies", async () => {
    const { db, run, store } = setup({ holdSync: true });
    const written: Array<Mutation> = [];
    const mutate = db.mutate;
    vi.spyOn(db, "mutate").mockImplementation((mutations) => {
      written.push(...mutations);
      return mutate(mutations);
    });
    const peer = contact(laneA, { name: text("Alice") });
    const migration = run({ contacts: [peer] });
    await new Promise((resolve) => setTimeout(resolve));
    expect(written).toEqual([]);

    // The account's copy, renamed on another device, syncs in before hydration completes.
    await Effect.runPromise(
      db.mutate([
        {
          kind: "upsert",
          table: "contact",
          ownerId: store.shardOwner("contacts", 0).id,
          row: { id: peer.id, name: text("Alice Edited") },
        },
      ]),
    );
    for (const owner of Effect.runSync(store.syncOwners()))
      db.finishSync(owner.id);
    const report = await migration;

    expect(
      report.counts.find((count) => count.table === "contact")?.ingested,
    ).toBe(0);
    expect(
      Effect.runSync(store.rows("contacts", "contact")).map((row) => row.name),
    ).toEqual(["Alice Edited"]);
  });

  it("does not wait for hydration when the device holds no legacy rows", async () => {
    const { run } = setup({ holdSync: true });
    const report = await run({});
    expect(report.counts.every((count) => count.ingested === 0)).toBe(true);
  });

  it("leaves the account's rotated pointers alone when a fresh device runs before sync", async () => {
    const migrated = setup();
    for (let rotation = 0; rotation < 3; rotation += 1)
      await Effect.runPromise(migrated.store.rotate("contacts"));

    const fresh = setup();
    const written: Array<Mutation> = [];
    const mutate = fresh.db.mutate;
    vi.spyOn(fresh.db, "mutate").mockImplementation((mutations) => {
      written.push(...mutations);
      return mutate(mutations);
    });
    await fresh.run({});

    // The fresh device writes later, so Evolu's per-column last-writer-wins applies its columns everywhere.
    await Effect.runPromise(migrated.db.mutate(written));
    expect(Effect.runSync(migrated.store.activeIndex("contacts"))).toBe(3);
    expect(written).toEqual([]);
  });

  it("starts the shards at index zero whatever lane index an older version left in storage", async () => {
    localStorage.setItem("linky.evolu.cashu_owner_index.v1", "7");
    const { run, store } = setup();
    await run({});
    expect(Effect.runSync(store.activeIndex("cashu"))).toBe(0);
  });

  it("re-ingests a lane row updated after the first run and leaves shard edits alone", async () => {
    const { run, store, rows } = setup();
    const peer = contact(laneA, { name: text("First") });
    await run({ contacts: [peer] });
    // An old-version edit made after the ingest carries a later timestamp.
    const laterEdit = {
      ...peer,
      name: text("Renamed"),
      updatedAt: iso((Date.now() + 20) / 1000),
    };
    await run({ contacts: [laterEdit] });
    expect(rows("contacts", "contact")[0]?.name).toBe("Renamed");

    // A shard edit newer than the legacy edit is what the shard keeps.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await Effect.runPromise(
      store.update("contacts", "contact", peer.id, {
        name: text("Edited on shard"),
      }),
    );
    await run({ contacts: [laterEdit] });
    expect(rows("contacts", "contact")[0]?.name).toBe("Edited on shard");
  });

  it("migrates an nsec-only login from the app owner alone", async () => {
    const { run, rows } = setup();
    const peer = contact(appOwner);
    await run(
      {
        contacts: [peer, contact(laneA)],
        messages: [message(appOwner, peer.id)],
      },
      new Set([appOwner.id]),
    );
    expect(rows("contacts", "contact")).toHaveLength(1);
    expect(rows("messages", "message")).toHaveLength(1);
  });
});

describe("readLegacyLaneIndexes", () => {
  it("reads the synced pointers of the meta owner and ignores the rest", () => {
    localStorage.setItem("linky.evolu.messages_owner_index.v1", "3");
    const indexes = readLegacyLaneIndexes(
      [
        ownerMeta(appOwner, "contacts", JSON.stringify({ index: 2 })),
        ownerMeta(appOwner, "cashu", "cashu-1"),
        ownerMeta(appOwner, "messages", JSON.stringify({ index: 1 })),
        ownerMeta(laneA, "transactions", JSON.stringify({ index: 7 })),
      ],
      appOwner.id,
    );
    expect(indexes).toEqual({
      contacts: 2,
      cashu: 1,
      messages: 1,
      transactions: 0,
    });
  });

  it("decodes both pointer formats and rejects the rest", () => {
    expect(legacyPointerIndex("messages-4", "messages")).toBe(4);
    expect(legacyPointerIndex("contacts-4", "messages")).toBeNull();
    expect(
      legacyPointerIndex(JSON.stringify({ index: 2, baseline: 9 }), "cashu"),
    ).toBe(2);
    expect(
      legacyPointerIndex(JSON.stringify({ index: -1 }), "cashu"),
    ).toBeNull();
    expect(legacyPointerIndex("{oops", "cashu")).toBeNull();
    expect(legacyPointerIndex(null, "cashu")).toBeNull();
  });

  it("clears the localStorage mirrors an older version wrote", () => {
    localStorage.setItem("linky.evolu.messages_owner_index.v1", "3");
    localStorage.setItem("linky.evolu.contacts_owner_index.v1", "1");
    clearLegacyLaneStorage();
    expect(
      localStorage.getItem("linky.evolu.messages_owner_index.v1"),
    ).toBeNull();
    expect(
      localStorage.getItem("linky.evolu.contacts_owner_index.v1"),
    ).toBeNull();
  });
});

describe("isLaneGracePeriodActive", () => {
  it("stays active for 180 days after the release", () => {
    const end = LANE_MIGRATION_RELEASED_AT_MS + LANE_MIGRATION_GRACE_PERIOD_MS;
    expect(isLaneGracePeriodActive(LANE_MIGRATION_RELEASED_AT_MS)).toBe(true);
    expect(isLaneGracePeriodActive(end - 1)).toBe(true);
    expect(isLaneGracePeriodActive(end)).toBe(false);
  });
});

describe("legacy snapshot change detection", () => {
  it("ignores shard rows and detects late legacy columns with the same timestamp", () => {
    const legacy = contact(laneA, { name: text("Before") });
    const owners = new Set([laneA.id]);
    const snapshot = { ...emptySnapshot, contacts: [legacy] };
    const key = legacySnapshotKey(snapshot, owners);
    expect(
      legacySnapshotKey(
        { ...snapshot, contacts: [legacy, contact(foreign)] },
        owners,
      ),
    ).toBe(key);
    expect(
      legacySnapshotKey(
        { ...snapshot, contacts: [{ ...legacy, name: text("After") }] },
        owners,
      ),
    ).not.toBe(key);
  });

  it("detects rows when a newly discovered legacy owner becomes eligible", () => {
    const snapshot = { ...emptySnapshot, contacts: [contact(laneB)] };
    expect(legacySnapshotKey(snapshot, new Set([laneA.id, laneB.id]))).not.toBe(
      legacySnapshotKey(snapshot, new Set([laneA.id])),
    );
  });
});
