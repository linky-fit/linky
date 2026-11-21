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
      { _tag: "OwnerSyncFailed", ownerId: app, error: "ProtocolQuotaError" },
      {
        tag: "OwnerSyncFailed",
        summary:
          "An Evolu relay failed the owner's sync with ProtocolQuotaError",
        links: { owner: app },
        payload: { ownerId: app, error: "ProtocolQuotaError" },
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
        _tag: "WriteFailed",
        write: {
          tables: ["message"],
          ownerIds: [shard],
          rows: 2,
          error: "disk full",
        },
      },
      {
        tag: "WriteFailed",
        summary: "Evolu could not store a message write of 2 rows",
        links: { owner: [shard] },
        payload: {
          tables: ["message"],
          ownerIds: [shard],
          rows: 2,
          error: "disk full",
        },
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
