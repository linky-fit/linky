import { describe, expect, it, vi } from "vitest";
import { createContactNameFormatter } from "./contactName";
import { buildPushNotificationTitle } from "./pushNotificationTitle";
import { notifyInsertedChatMessage } from "../app/hooks/messages/inboxNotifications";
import { formatShortNpub } from "./formatting";

const alice = "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z";
const other =
  "npub1zyxwvutsrqponmlkjihgfedcbazyxwvutsrqponmlkjihgfedcbaz123456";

describe("safe notification names", () => {
  it("uses the same collision label in foreground and service-worker notifications", () => {
    const contacts = [
      { name: "Alice", npub: alice, nameSetByUser: 1 },
      { name: "Ali\u202ece", npub: other },
    ];
    const remote = contacts[1];
    if (!remote) throw new Error("missing fixture");
    const name = createContactNameFormatter(contacts)(remote);
    const expected = `Alice (${formatShortNpub(other)})`;
    expect(buildPushNotificationTitle({ contactName: name })).toBe(
      `Linky - ${expected}`,
    );
    const maybeShowPwaNotification = vi.fn(async () => {});
    notifyInsertedChatMessage(
      {
        contactId: "remote",
        messageId: "message",
        content: "hello",
        createdAtSec: 100,
        peerPubkey: "remote",
      },
      {
        findContact: () => ({ id: "remote", name, npub: other }),
        formatDisplayedAmountText: String,
        maybeShowPwaNotification,
        messages: [],
        onOpenInboxMessageToast: vi.fn(),
        pushToast: vi.fn(),
        route: { kind: "contacts" },
        t: (key) => key,
      },
    );
    expect(maybeShowPwaNotification).toHaveBeenCalledWith(
      expected,
      "hello",
      "msg_remote",
    );
  });

  it("sanitizes fallback titles and identity labels", () => {
    expect(
      buildPushNotificationTitle({ title: "Bank\u202e\n support\u200b" }),
    ).toBe("Bank support");
    expect(buildPushNotificationTitle({ title: "\u200b" })).toBe("Linky");
    expect(
      buildPushNotificationTitle({ recipientIdentifier: "Ali\u202ece" }),
    ).toBe("Linky - Alice");
  });
});
