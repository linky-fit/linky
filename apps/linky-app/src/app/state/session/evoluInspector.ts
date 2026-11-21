import type { OwnerId } from "@linky-fit/linksync";
import type { LinkyEvoluEvent } from "@linky-fit/linksync/evolu";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { getInspectorEmissionEnabled } from "../../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../../devtools/inspector/reportInspectorRows";
import { getUnknownErrorMessage } from "../../../utils/unknown";

/** A healthy write applies in tens of ms; one past this is worth a row. */
const SLOW_WRITE_MS = 250;

export const reportShardsSubscribed = (
  reason: "boot" | "rotation" | "forget",
  owners: ReadonlyArray<OwnerId>,
): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.sync",
      tag: "ShardsSubscribed",
      summary: `Syncing the app owner and ${owners.length - 1} shards`,
      links: { owner: [...owners] },
      payload: { reason, owners: owners.length },
    },
  ]);
};

/** Turns a linksync Evolu event into its inspector row. */
export const reportLinkyEvoluEvent = (event: LinkyEvoluEvent): void => {
  if (!getInspectorEmissionEnabled()) return;
  switch (event._tag) {
    case "UserRelaysMigrated":
      reportAppLog({
        tag: "evolu.userServersMigrated",
        summary: "Kept the configured Evolu servers that are not recommended",
        payload: {
          legacyServerUrls: [...event.legacyServerUrls],
          defaultsRemoved: event.defaultsRemoved,
          isExistingInstall: event.isExistingInstall,
        },
      });
      return;
    case "ShardPointerRepairFailed":
      reportAppLog({
        tag: "evolu.shardPointerRepairFailed",
        summary: "Moving reset shard pointers back up failed",
        payload: { error: getUnknownErrorMessage(event.error, "unknown") },
      });
      return;
    case "ShardsSubscribed":
      reportShardsSubscribed(event.reason, event.owners);
      return;
    case "OwnerSyncFailed":
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.sync",
          tag: "OwnerSyncFailed",
          summary: `An Evolu relay failed the owner's sync with ${event.error}`,
          links: { owner: event.ownerId },
          payload: { ownerId: event.ownerId, error: event.error },
        },
      ]);
      return;
    case "ShardRotated":
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.sync",
          tag: "ShardRotated",
          summary: `${event.rotation.scope} shard pointer moved to index ${event.rotation.index}`,
          links: { owner: event.owner },
          payload: event.rotation,
        },
      ]);
      return;
    case "AccountHydrated":
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.sync",
          tag: "AccountHydrated",
          summary: `Account data arrived for the app owner and ${event.owners.length - 1} shards`,
          links: { owner: [...event.owners] },
          payload: {
            owners: event.owners.length,
            sincePageLoadMs: performance.now(),
          },
        },
      ]);
      return;
    case "OwnerDeleted":
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.sync",
          tag: "OwnerDeleted",
          summary: "Local data for a forgotten shard owner was deleted",
          links: { owner: event.ownerId },
          payload: { ownerId: event.ownerId },
        },
      ]);
      return;
    case "WriteFailed":
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.sync",
          tag: "WriteFailed",
          summary: `Evolu could not store a ${event.write.tables.join(", ")} write of ${event.write.rows} rows`,
          links: { owner: [...event.write.ownerIds] },
          payload: event.write,
        },
      ]);
      return;
    case "WriteApplied":
      if (event.write.durationMs < SLOW_WRITE_MS) return;
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.sync",
          tag: "WriteSlow",
          summary: `A ${event.write.tables.join(", ")} write of ${event.write.rows} rows took ${event.write.durationMs} ms to apply`,
          links: {},
          payload: event.write,
        },
      ]);
      return;
    case "ShardPointersRepaired":
      reportInspectorRows(
        event.repairs.map(({ repair, owner }) => ({
          at: Date.now(),
          channel: "evolu.sync",
          tag: "ShardPointerRepaired",
          summary: `${repair.scope} shard pointer moved back up from index ${repair.from} to ${repair.to}`,
          links: { owner },
          payload: repair,
        })),
      );
      return;
  }
};
