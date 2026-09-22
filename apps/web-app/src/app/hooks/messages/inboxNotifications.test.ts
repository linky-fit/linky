import {
  PaymentNoticeReceived,
  Pubkey,
  RumorId,
  UnixSeconds,
} from "@linky/linkstr";
import { getPublicKey } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { buildCashuToken } from "../../../testUtils/cashuToken";
import type { PushToastOptions } from "../../../hooks/useToasts";
import type { BankPaymentOffer } from "@linky/proxy-payment";
import type { LocalNostrMessage } from "../../types/appTypes";
import {
  handlePaymentNoticeReceived,
  notifyBankOfferSnapshot,
  notifyInsertedChatMessage,
  type InboxNotificationsContext,
} from "./inboxNotifications";

const peerPubkey = getPublicKey(createSecretKey(2));
const NOTICE_RUMOR_ID = "a".repeat(64);
const SNAPSHOT_RUMOR_ID = "b".repeat(64);
const SENT_AT = 1_700_000_100;

interface HarnessOptions {
  messages?: LocalNostrMessage[];
  route?: { id?: string; kind: string; offerId?: string };
}

const createHarness = (options: HarnessOptions = {}) => {
  const maybeShowPwaNotification = vi.fn<
    (title: string, body: string, tag?: string) => Promise<void>
  >(async () => {});
  const onOpenInboxMessageToast =
    vi.fn<(params: { contactId: string; messageId?: string }) => void>();
  const pushToast =
    vi.fn<(message: string, options?: PushToastOptions) => void>();

  const ctx: InboxNotificationsContext = {
    findContact: (pubkey) =>
      pubkey === peerPubkey
        ? { id: "contact-1", name: "Alice", npub: null }
        : null,
    formatDisplayedAmountText: (amountSat) => `${amountSat} sat`,
    maybeShowPwaNotification,
    messages: options.messages ?? [],
    onOpenInboxMessageToast,
    pushToast,
    route: options.route ?? { kind: "contacts" },
    t: (key) =>
      key === "chatIncomingMessageToast" ? "{name}: {message}" : key,
  };

  return {
    ctx,
    maybeShowPwaNotification,
    onOpenInboxMessageToast,
    pushToast,
  };
};

const insertedMessage = {
  contactId: "contact-1",
  content: "hello",
  createdAtSec: SENT_AT,
  messageId: "message-1",
  peerPubkey,
};

describe("notifyInsertedChatMessage", () => {
  it("toasts and shows a notification for a message outside the open chat", () => {
    const harness = createHarness();

    notifyInsertedChatMessage(insertedMessage, harness.ctx);

    expect(harness.pushToast).toHaveBeenCalledWith(
      "Alice: hello",
      expect.objectContaining({ onClick: expect.any(Function) }),
    );
    expect(harness.maybeShowPwaNotification).toHaveBeenCalledWith(
      "Alice",
      "hello",
      `msg_${peerPubkey}`,
    );
  });

  it("opens the chat scrolled to the message when the toast is clicked", () => {
    const harness = createHarness();

    notifyInsertedChatMessage(insertedMessage, harness.ctx);
    const options = harness.pushToast.mock.calls[0]?.[1];
    options?.onClick?.();

    expect(harness.onOpenInboxMessageToast).toHaveBeenCalledWith({
      contactId: "contact-1",
      messageId: "message-1",
    });
  });

  it("stays silent for the open chat", () => {
    const harness = createHarness({
      route: { kind: "chat", id: "contact-1" },
    });

    notifyInsertedChatMessage(insertedMessage, harness.ctx);

    expect(harness.pushToast).not.toHaveBeenCalled();
    expect(harness.maybeShowPwaNotification).not.toHaveBeenCalled();
  });

  it("stays silent for cashu token messages", () => {
    const harness = createHarness();

    notifyInsertedChatMessage(
      { ...insertedMessage, content: buildCashuToken({ amounts: [8] }) },
      harness.ctx,
    );

    expect(harness.pushToast).not.toHaveBeenCalled();
    expect(harness.maybeShowPwaNotification).not.toHaveBeenCalled();
  });
});

describe("handlePaymentNoticeReceived", () => {
  const notice = (
    overrides: Partial<
      ConstructorParameters<typeof PaymentNoticeReceived>[0]
    > = {},
  ): PaymentNoticeReceived =>
    new PaymentNoticeReceived({
      noticeId: RumorId.make(NOTICE_RUMOR_ID),
      from: Pubkey.make(peerPubkey),
      context: null,
      offerId: null,
      sentAt: UnixSeconds.make(SENT_AT),
      ...overrides,
    });

  it("notifies on a live notice", () => {
    const harness = createHarness();

    handlePaymentNoticeReceived(notice(), "contact-1", "live", harness.ctx);

    expect(harness.pushToast).toHaveBeenCalledWith(
      "Alice: notificationReceivedMoney",
    );
    expect(harness.maybeShowPwaNotification).toHaveBeenCalledWith(
      "Alice",
      "notificationReceivedMoney",
      NOTICE_RUMOR_ID,
    );
  });

  it("uses the reimbursement copy for bank-offer notices", () => {
    const harness = createHarness();

    handlePaymentNoticeReceived(
      notice({ context: "bank_payment_offer", offerId: "offer-1" }),
      "contact-1",
      "live",
      harness.ctx,
    );

    expect(harness.maybeShowPwaNotification).toHaveBeenCalledWith(
      "Alice",
      "notificationReceivedBankPaymentReimbursement",
      NOTICE_RUMOR_ID,
    );
  });

  it("stays silent on backfill", () => {
    const harness = createHarness();

    handlePaymentNoticeReceived(notice(), "contact-1", "backfill", harness.ctx);

    expect(harness.pushToast).not.toHaveBeenCalled();
    expect(harness.maybeShowPwaNotification).not.toHaveBeenCalled();
  });

  it("stays silent when the announced token already arrived", () => {
    const harness = createHarness({
      messages: [
        {
          contactId: "contact-1",
          content: buildCashuToken({ amounts: [8] }),
          createdAtSec: SENT_AT - 30,
          direction: "in",
          id: "message-token",
          pubkey: peerPubkey,
          rumorId: "c".repeat(64),
          status: "sent",
          wrapId: "c".repeat(64),
        },
      ],
    });

    handlePaymentNoticeReceived(notice(), "contact-1", "live", harness.ctx);

    expect(harness.pushToast).not.toHaveBeenCalled();
    expect(harness.maybeShowPwaNotification).not.toHaveBeenCalled();
  });
});

describe("notifyBankOfferSnapshot", () => {
  const offer = (
    status: BankPaymentOffer["status"] = "offered",
  ): BankPaymentOffer => ({
    amountSat: 40_000,
    amountText: "500 Kč",
    bankPaidAtSec: null,
    clientId: null,
    content: "{}",
    createdAtSec: SENT_AT,
    expiresAtSec: null,
    extensionSec: null,
    initiatedAtSec: SENT_AT,
    offerId: "offer-1",
    offererPublicKey: peerPubkey,
    peer: peerPubkey,
    snapshotId: SNAPSHOT_RUMOR_ID,
    spdPayload: null,
    status,
    statusUpdatedAtSec: SENT_AT,
    text: "Zaplatíš za mě?",
  });

  const incomingScope = {
    contactId: "contact-1",
    delivery: "live",
    isOutgoing: false,
    isSelfAuthored: false,
    peerPubkey,
  } as const;

  it("toasts and notifies for a live incoming offer", () => {
    const harness = createHarness();
    notifyBankOfferSnapshot(offer(), incomingScope, harness.ctx);
    expect(harness.pushToast).toHaveBeenCalledWith("Alice: Zaplatíš za mě?");
    expect(harness.maybeShowPwaNotification).toHaveBeenCalledWith(
      "Alice",
      "Zaplatíš za mě?",
      SNAPSHOT_RUMOR_ID,
    );
  });

  it("stays silent on backfill, for self-authored snapshots and inside the open chat", () => {
    for (const [scope, options] of [
      [{ ...incomingScope, delivery: "backfill" }, {}],
      [{ ...incomingScope, isSelfAuthored: true }, {}],
      [incomingScope, { route: { kind: "chat", id: "contact-1" } }],
    ] as const) {
      const harness = createHarness(options);
      notifyBankOfferSnapshot(offer(), scope, harness.ctx);
      expect(harness.pushToast).not.toHaveBeenCalled();
    }
  });

  it("notifies the offerer of a decline and opens the contact chat from the toast", () => {
    const harness = createHarness();
    notifyBankOfferSnapshot(
      offer("declined"),
      { ...incomingScope, isOutgoing: true },
      harness.ctx,
    );
    expect(harness.maybeShowPwaNotification).toHaveBeenCalledWith(
      "Alice",
      "bankPaymentOfferDeclinedNotification",
      SNAPSHOT_RUMOR_ID,
    );
    const options = harness.pushToast.mock.calls[0]?.[1];
    options?.onClick?.();
    expect(harness.onOpenInboxMessageToast).toHaveBeenCalledWith({
      contactId: "contact-1",
    });
  });
});
