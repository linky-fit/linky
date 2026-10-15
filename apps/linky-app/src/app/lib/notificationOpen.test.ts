import { describe, expect, it } from "vitest";
import {
  readNotificationOpenData,
  unwrapNotificationOpenValue,
} from "./notificationOpen";

describe("notification open payload", () => {
  it("extracts data from a Capacitor iOS notification action", () => {
    const data = {
      outerEventId: "outer-event",
      recipientPubkey: "recipient",
      senderPubkey: "sender",
    };

    expect(
      readNotificationOpenData({
        actionId: "tap",
        notification: { data },
      }),
    ).toEqual(data);
  });

  it("parses JSON-encoded native notification data", () => {
    expect(
      readNotificationOpenData({
        notification: {
          data: JSON.stringify({
            outerEventId: "outer-event",
            relayHints: JSON.stringify(["wss://relay.example"]),
          }),
        },
      }),
    ).toEqual({
      outerEventId: "outer-event",
      relayHints: JSON.stringify(["wss://relay.example"]),
    });
  });

  it("leaves non-JSON route strings intact", () => {
    expect(unwrapNotificationOpenValue(" #contacts ")).toBe("#contacts");
  });

  it("parses JSON-encoded relay hint arrays", () => {
    expect(unwrapNotificationOpenValue('["wss://relay.example"]')).toEqual([
      "wss://relay.example",
    ]);
  });
});
