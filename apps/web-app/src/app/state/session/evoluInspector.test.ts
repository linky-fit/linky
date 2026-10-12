import { OwnerId } from "@linky-fit/linksync";
import type { LinkyEvoluEvent } from "@linky-fit/linksync/evolu";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inspector = vi.hoisted(() => ({
  enabled: true,
  rows: vi.fn(),
  appLog: vi.fn(),
}));
vi.mock("../../../devtools/inspector/inspectorEnabled", () => ({
  getInspectorEmissionEnabled: () => inspector.enabled,
}));
vi.mock("../../../devtools/inspector/reportInspectorRows", () => ({
  reportInspectorRows: inspector.rows,
}));
vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: inspector.appLog,
}));

import { reportLinkyEvoluEvent } from "./evoluInspector";

const app = OwnerId.orThrow("F0xh0HpiAx5shgCgtGENww");
const shard = OwnerId.orThrow("AAAAAAAAAAAAAAAAAAAAAA");

beforeEach(() => {
  inspector.enabled = true;
  inspector.rows.mockClear();
  inspector.appLog.mockClear();
});

describe("reportLinkyEvoluEvent", () => {
  it.each<[LinkyEvoluEvent, Record<string, unknown>]>([
    [
      {
        _tag: "OwnerSyncFailed",
        failure: { ownerId: app, error: "QuotaError", endsRound: false },
      },
      {
        tag: "OwnerSyncFailed",
        summary:
          "An Evolu relay answered with QuotaError before any error-free answer; the owner stays unsynced",
        links: { owner: app },
        payload: { ownerId: app, error: "QuotaError", endsRound: false },
      },
    ],
    [
      {
        _tag: "ShardRotated",
        rotation: { scope: "messages", index: 2 },
        owner: shard,
      },
      {
        tag: "ShardRotated",
        summary: "messages shard pointer moved to index 2",
        links: { owner: shard },
        payload: { scope: "messages", index: 2 },
      },
    ],
    [
      { _tag: "ShardsSubscribed", reason: "boot", owners: [app, shard] },
      {
        tag: "ShardsSubscribed",
        summary: "Syncing the app owner and 1 shards",
        links: { owner: [app, shard] },
        payload: { reason: "boot", owners: 2 },
      },
    ],
    [
      {
        _tag: "WriteUnconfirmed",
        write: { table: "message", ownerId: shard, id: "row-1" },
      },
      {
        tag: "WriteUnconfirmed",
        summary:
          "Evolu did not confirm a message write within 10 s; it may have been dropped",
        links: { owner: shard, row: "row-1" },
        payload: { table: "message", ownerId: shard, id: "row-1" },
      },
    ],
    [
      {
        _tag: "ShardPointersRepaired",
        repairs: [{ repair: { scope: "cashu", from: 0, to: 3 }, owner: shard }],
      },
      {
        tag: "ShardPointerRepaired",
        summary: "cashu shard pointer moved back up from index 0 to 3",
        links: { owner: shard },
        payload: { scope: "cashu", from: 0, to: 3 },
      },
    ],
    [
      {
        _tag: "SlowEvoluCall",
        call: {
          call: "write",
          tables: ["message"],
          ids: ["row-1"],
          owners: [shard],
          elapsedMs: 10_000,
          answered: false,
          load: {
            subscribedTables: 9,
            subscribedRows: 1200,
            pendingWrites: 2,
            pendingReads: 0,
          },
        },
      },
      {
        tag: "WriteSlow",
        summary:
          "Evolu has not answered a write to message after 10.0 s (9 subscribed tables, 1200 rows)",
        links: { owner: [shard], row: ["row-1"] },
        payload: expect.objectContaining({ call: "write", answered: false }),
      },
    ],
    [
      {
        _tag: "SlowEvoluCall",
        call: {
          call: "readTable",
          tables: ["cashuProof"],
          ids: [],
          owners: [],
          elapsedMs: 1_460,
          answered: true,
          load: {
            subscribedTables: 9,
            subscribedRows: 1200,
            pendingWrites: 0,
            pendingReads: 1,
          },
        },
      },
      {
        tag: "ReadSlow",
        summary:
          "Evolu answered readTable of cashuProof after 1.5 s (9 subscribed tables, 1200 rows)",
        links: { owner: [], row: [] },
        payload: expect.objectContaining({ call: "readTable", answered: true }),
      },
    ],
  ])("reports %o as its evolu.sync row", (event, row) => {
    reportLinkyEvoluEvent(event);
    expect(inspector.rows).toHaveBeenCalledWith([
      { at: expect.any(Number), channel: "evolu.sync", ...row },
    ]);
  });

  it("reports hydration with the time since page load", () => {
    reportLinkyEvoluEvent({ _tag: "AccountHydrated", owners: [app, shard] });
    expect(inspector.rows).toHaveBeenCalledWith([
      {
        at: expect.any(Number),
        channel: "evolu.sync",
        tag: "AccountHydrated",
        summary: "Account data arrived for the app owner and 1 shards",
        links: { owner: [app, shard] },
        payload: { owners: 2, sincePageLoadMs: expect.any(Number) },
      },
    ]);
  });

  it("logs the relay migration and a failed pointer repair", () => {
    reportLinkyEvoluEvent({
      _tag: "UserRelaysMigrated",
      legacyServerUrls: ["wss://a.test"],
      defaultsRemoved: true,
      isExistingInstall: false,
    });
    reportLinkyEvoluEvent({
      _tag: "ShardPointerRepairFailed",
      error: new Error("relay gone"),
    });
    expect(inspector.appLog.mock.calls).toEqual([
      [
        {
          tag: "evolu.userServersMigrated",
          summary: "Kept the configured Evolu servers that are not recommended",
          payload: {
            legacyServerUrls: ["wss://a.test"],
            defaultsRemoved: true,
            isExistingInstall: false,
          },
        },
      ],
      [
        {
          tag: "evolu.shardPointerRepairFailed",
          summary: "Moving reset shard pointers back up failed",
          payload: { error: "relay gone" },
        },
      ],
    ]);
  });

  it("reports nothing while the inspector is off", () => {
    inspector.enabled = false;
    reportLinkyEvoluEvent({ _tag: "AccountHydrated", owners: [app] });
    expect(inspector.rows).not.toHaveBeenCalled();
  });
});
