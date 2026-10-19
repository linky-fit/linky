import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { readNotificationOpenData } from "./notificationOpen";
import {
  readNotificationOpenHashLink,
  readNotificationOpenTarget,
} from "./notificationOpenTarget";

const data = {
  outerEventId: "a".repeat(64),
  recipientPubkey: makeIdentity().pubkey,
  relayHints: ["wss://attacker.example", "ws://192.168.1.1"],
};
const target = {
  outerEventId: data.outerEventId,
  recipientPubkey: data.recipientPubkey,
  senderPubkey: null,
};

describe("notification open targets", () => {
  it("discards hints from warm service-worker and native payloads", () => {
    for (const payload of [
      data,
      JSON.stringify(data),
      {
        notification: {
          data: { ...data, relayHints: JSON.stringify(data.relayHints) },
        },
      },
    ]) {
      expect(
        readNotificationOpenTarget(readNotificationOpenData(payload)),
      ).toEqual(target);
    }
  });

  it("retains a fragment's target but drops its relay hints and the parameter from the route", () => {
    const link = readNotificationOpenHashLink(
      `#contacts?${new URLSearchParams({ notificationOpen: JSON.stringify(data), tab: "1" })}`,
    );
    expect(readNotificationOpenTarget(link?.detail)).toEqual(target);
    expect(link?.routePath).toBe("contacts?tab=1");
    expect(readNotificationOpenHashLink("#contacts?tab=1")).toBeNull();
  });
});
