import * as Evolu from "@evolu/common";
import type { LegacyTokenRow } from "@linky/linkshu";
import {
  activeNostrIdentityId,
  createId,
  createLinkyStore,
  directConversationIdFor,
  linkyTableColumns,
  makeInMemoryShardDb,
  makeSettingsRepository,
  type LinkyDbSchema,
} from "@linky/linksync";
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
  DEFAULT_MINT_SETTING_KEY,
  isLaneGracePeriodActive,
  LANE_MIGRATION_CUTOFF_SETTING_KEY,
  LANE_MIGRATION_GRACE_PERIOD_MS,
  legacyPointerIndex,
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

const setup = () => {
  const db = makeInMemoryShardDb<LinkyDbSchema>(linkyTableColumns);
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
    nowMs = 1_000,
  ) =>
    runLaneToShardMigration({
      store,
      snapshot: { ...emptySnapshot, ...snapshot },
      legacyOwnerIds,
      ingestLegacyTokens,
      nowMs,
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
  it("splits contacts into profile and conversation rows", async () => {
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
      Effect.runSync(
        makeSettingsRepository(store).get(DEFAULT_MINT_SETTING_KEY),
      ),
    ).toBe("https://mint.example");
  });

  it("writes pointers and the cutoff once and is idempotent", async () => {
    const { run, store } = setup();
    const peer = contact(laneA);
    const first = await run({ contacts: [peer] }, undefined, 5_000);
    expect(first.pointersWritten).toBe(4);
    expect(first.cutoffMs).toBe(5_000);

    const second = await run({ contacts: [peer] }, undefined, 9_000);
    expect(second.pointersWritten).toBe(0);
    expect(second.cutoffMs).toBe(5_000);
    expect(
      second.counts.find((count) => count.table === "contact")?.ingested,
    ).toBe(0);
    expect(
      Effect.runSync(
        makeSettingsRepository(store).get(LANE_MIGRATION_CUTOFF_SETTING_KEY),
      ),
    ).toBe("5000");
    expect(Effect.runSync(store.rows("meta", "shardPointer"))).toHaveLength(4);
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
  it("stays active without a cutoff and for 180 days after it", () => {
    expect(isLaneGracePeriodActive(null, 1)).toBe(true);
    expect(isLaneGracePeriodActive(1_000, 1_000 + 10)).toBe(true);
    expect(
      isLaneGracePeriodActive(1_000, 1_000 + LANE_MIGRATION_GRACE_PERIOD_MS),
    ).toBe(false);
  });
});
