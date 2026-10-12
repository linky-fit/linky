import type { OwnerId } from "@linky-fit/linksync";
import type { LinkyEvoluEvent, SlowEvoluCall } from "@linky-fit/linksync/evolu";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { getInspectorEmissionEnabled } from "../../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../../devtools/inspector/reportInspectorRows";
import { getUnknownErrorMessage } from "../../../utils/unknown";

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

const reportSlowEvoluCall = (call: SlowEvoluCall): void => {
  const what =
    call.call === "write"
      ? `a write to ${call.tables.join(", ")}`
      : `${call.call} of ${call.tables.join(", ")}`;
  const seconds = (call.elapsedMs / 1000).toFixed(1);
  const { subscribedTables, subscribedRows } = call.load;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "evolu.sync",
      tag: call.call === "write" ? "WriteSlow" : "ReadSlow",
      summary: `${
        call.answered
          ? `Evolu answered ${what} after ${seconds} s`
          : `Evolu has not answered ${what} after ${seconds} s`
      } (${subscribedTables} subscribed tables, ${subscribedRows} rows)`,
      links: { owner: [...call.owners], row: [...call.ids] },
      payload: call,
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
    case "OwnerSyncFailed": {
      const { ownerId, error, endsRound } = event.failure;
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.sync",
          tag: "OwnerSyncFailed",
          summary: endsRound
            ? `An Evolu relay answered with ${error}; the owner's sync round ended there`
            : `An Evolu relay answered with ${error} before any error-free answer; the owner stays unsynced`,
          links: { owner: ownerId },
          payload: { ownerId, error, endsRound },
        },
      ]);
      return;
    }
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
    case "WriteUnconfirmed":
      reportInspectorRows([
        {
          at: Date.now(),
          channel: "evolu.sync",
          tag: "WriteUnconfirmed",
          summary: `Evolu did not confirm a ${event.write.table} write within 10 s; it may have been dropped`,
          links: { owner: event.write.ownerId, row: event.write.id },
          payload: event.write,
        },
      ]);
      return;
    case "SlowEvoluCall":
      reportSlowEvoluCall(event.call);
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
