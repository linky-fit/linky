import { makeIdentity } from "@linky/linkstr/testing";
import { describe, expect, it } from "vitest";
import { readNotificationOpenData } from "./notificationOpen";
import {
  consumeNotificationOpenDetailFromHash,
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

  it("retains a cold-start target but drops its relay hints and removes the hash parameter", () => {
    window.location.hash = `#contacts?${new URLSearchParams({ notificationOpen: JSON.stringify(data) })}`;
    expect(
      readNotificationOpenTarget(consumeNotificationOpenDetailFromHash()),
    ).toEqual(target);
    expect(window.location.hash).toBe("#contacts");
    expect(consumeNotificationOpenDetailFromHash()).toBeNull();
  });
});
