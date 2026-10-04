import { createId, type LinkyStore } from "@linky-fit/linksync";
import { Effect } from "effect";
import { act, Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { LANE_MIGRATION_DONE_STORAGE_KEY } from "./laneToShardMigration";

const legacy = vi.hoisted(() => ({
  store: Promise.resolve<LinkyStore | null>(null),
  tables: new Map<string, ReadonlyArray<Readonly<Record<string, unknown>>>>(),
  update: vi.fn(() => ({ ok: true })),
  reportAppLog: vi.fn(),
  reportInspectorRows: vi.fn(),
}));

vi.mock("../../evolu", () => {
  const query = (table: string) => () => table;
  return {
    getLinkyStore: () => legacy.store,
    evolu: {
      loadQuery: (table: string) =>
        Promise.resolve(legacy.tables.get(table) ?? []),
      subscribeQuery: () => () => () => {},
      useOwner: () => {},
      update: legacy.update,
    },
    createCashuOperationsAllQuery: query("cashuOperation"),
    createCashuProofsAllQuery: query("cashuProof"),
    createCashuTokensAllQuery: query("cashuToken"),
    createContactsAllQuery: query("contact"),
    createNostrIdentitiesAllQuery: query("nostrIdentity"),
    createNostrMessagesAllQuery: query("nostrMessage"),
    createNostrReactionsAllQuery: query("nostrReaction"),
    createOwnerMetaAllQuery: query("ownerMeta"),
    createTransactionsAllQuery: query("transaction"),
  };
});
vi.mock("../../platform/identitySecrets", () => ({
  readStoredSlip39Seed: () => Promise.resolve(null),
}));
vi.mock("../../devtools/inspector/appLog", () => ({
  reportAppLog: legacy.reportAppLog,
}));
vi.mock("../../devtools/inspector/inspectorEnabled", () => ({
  getInspectorEmissionEnabled: () => true,
}));
vi.mock("../../devtools/inspector/reportInspectorRows", () => ({
  reportInspectorRows: legacy.reportInspectorRows,
}));

const legacyRow = (ownerId: string, row: Record<string, unknown>) => ({
  ownerId,
  createdAt: "2023-11-14T22:13:20.000Z",
  updatedAt: "2023-11-14T22:13:20.000Z",
  isDeleted: null,
  ...row,
});

/** Mounts the hook the way AppShell does and exposes whether the screen is up. */
const mountMigration = async () => {
  // A fresh module per test: the hook shares one boot run per page load.
  const { useLaneToShardMigration } = await import("./useLaneToShardMigration");
  const screen = { migrating: false };
  const Probe = ({ onState }: { onState: (migrating: boolean) => void }) => {
    onState(useLaneToShardMigration());
    return null;
  };
  const view = await renderIntoDocument(
    <Suspense fallback={null}>
      <Probe
        onState={(migrating) => {
          screen.migrating = migrating;
        }}
      />
    </Suspense>,
  );
  await act(async () => {});
  return { screen, view };
};

const doneFlag = () => localStorage.getItem(LANE_MIGRATION_DONE_STORAGE_KEY);

beforeEach(() => {
  vi.resetModules();
  legacy.tables.clear();
  legacy.update.mockClear();
  legacy.reportAppLog.mockClear();
  legacy.reportInspectorRows.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("useLaneToShardMigration", () => {
  it("gives the screen way after its bound while lane rows still wait for the Evolu relay", async () => {
    vi.useFakeTimers();
    const { appOwner, db, store } = makeTestLinkyStore(1, { holdSync: true });
    legacy.store = Promise.resolve(store);
    legacy.tables.set("contact", [
      legacyRow(appOwner.id, { id: createId(), name: "Held contact" }),
    ]);
    const shardContacts = () =>
      Effect.runSync(store.rows("contacts", "contact")).map((row) => row.name);

    const { screen, view } = await mountMigration();
    expect(screen.migrating).toBe(true);

    const { MIGRATING_SCREEN_MAX_MS } =
      await import("./useLaneToShardMigration");
    await act(() => vi.advanceTimersByTimeAsync(MIGRATING_SCREEN_MAX_MS));
    expect(screen.migrating).toBe(false);
    expect(legacy.reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "evolu.laneMigrationScreenReleased" }),
    );
    expect(doneFlag()).toBeNull();
    expect(shardContacts()).toEqual([]);

    await act(async () => {
      for (const owner of Effect.runSync(store.syncOwners()))
        db.finishSync(owner.id);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(doneFlag()).toBe("1");
    expect(shardContacts()).toEqual(["Held contact"]);
    await view.unmount();
  });

  it("marks a legacy proof spent once its shard copy is spent, and reports it", async () => {
    const { appOwner, db, store } = makeTestLinkyStore(1);
    legacy.store = Promise.resolve(store);
    const proof = {
      id: createId<"CashuProof">(),
      mint: "https://mint.example",
      unit: "sat",
      keysetId: "00legacy",
      amount: 8,
      secret: "legacy-proof",
      c: `02${"ab".repeat(32)}`,
      dleq: null,
      operationId: null,
    };
    legacy.tables.set("cashuProof", [
      legacyRow(appOwner.id, { ...proof, state: "held" }),
    ]);
    await Effect.runPromise(
      db.mutate([
        {
          kind: "upsert",
          table: "cashuProof",
          ownerId: store.shardOwner("cashu", 0).id,
          row: { ...proof, state: "spent" },
        },
      ]),
    );

    const { view } = await mountMigration();
    await vi.waitFor(() => expect(doneFlag()).toBe("1"));

    await vi.waitFor(() =>
      expect(legacy.update).toHaveBeenCalledWith(
        "cashuProof",
        { id: proof.id, state: "spent" },
        { ownerId: appOwner.id },
      ),
    );
    expect(legacy.reportInspectorRows).toHaveBeenCalledWith([
      expect.objectContaining({
        tag: "LaneSpentProofsMirrored",
        summary: "Marked 1 legacy proofs spent",
      }),
    ]);
    await view.unmount();
  });
});
