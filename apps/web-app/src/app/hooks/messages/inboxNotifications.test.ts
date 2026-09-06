import {
  BankOfferId,
  BankOfferSnapshotReceived,
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
import { getLinkyBankPaymentOfferInfo } from "../../lib/bankPaymentOffer";
import type { LocalNostrMessage } from "../../types/appTypes";
import {
  bankOfferContentFromSnapshot,
  handleBankOfferSnapshotReceived,
  handlePaymentNoticeReceived,
  notifyInsertedChatMessage,
  type InboxNotificationsContext,
} from "./inboxNotifications";

const peerPubkey = getPublicKey(createSecretKey(2));
const NOTICE_RUMOR_ID = "a".repeat(64);
const SNAPSHOT_RUMOR_ID = "b".repeat(64);
const SENT_AT = 1_700_000_100;

interface HarnessOptions {
  bankPaymentOfferMessages?: LocalNostrMessage[];
  messages?: LocalNostrMessage[];
  route?: { id?: string; kind: string; offerId?: string };
}

const createHarness = (options: HarnessOptions = {}) => {
  const maybeShowPwaNotification = vi.fn<
    (title: string, body: string, tag?: string) => Promise<void>
  >(async () => {});
  const onBankPaymentOfferMessage =
    vi.fn<(message: LocalNostrMessage) => void>();
  const onOpenInboxMessageToast =
    vi.fn<(params: { contactId: string; messageId?: string }) => void>();
  const pushToast =
    vi.fn<(message: string, options?: PushToastOptions) => void>();

  const ctx: InboxNotificationsContext = {
    bankPaymentOfferMessages: options.bankPaymentOfferMessages ?? [],
    findContact: (pubkey) =>
      pubkey === peerPubkey
        ? { id: "contact-1", name: "Alice", npub: null }
        : null,
    formatDisplayedAmountText: (amountSat) => `${amountSat} sat`,
    maybeShowPwaNotification,
    messages: options.messages ?? [],
    onBankPaymentOfferMessage,
    onOpenInboxMessageToast,
    pushToast,
    route: options.route ?? { kind: "contacts" },
    t: (key) =>
      key === "chatIncomingMessageToast" ? "{name}: {message}" : key,
  };

  return {
    ctx,
    maybeShowPwaNotification,
    onBankPaymentOfferMessage,
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

describe("handleBankOfferSnapshotReceived", () => {
  const snapshot = (
    overrides: Partial<
      ConstructorParameters<typeof BankOfferSnapshotReceived>[0]
    > = {},
  ): BankOfferSnapshotReceived =>
    new BankOfferSnapshotReceived({
      snapshotId: RumorId.make(SNAPSHOT_RUMOR_ID),
      from: Pubkey.make(peerPubkey),
      offerId: BankOfferId.make("offer-1"),
      offerer: Pubkey.make(peerPubkey),
      status: "offered",
      amountText: "500 Kč",
      text: "Zaplatíš za mě?",
      amountSat: 40_000,
      initiatedAtSec: UnixSeconds.make(SENT_AT),
      bankPaidAtSec: null,
      expiresAtSec: null,
      extensionSec: null,
      spdPayload: null,
      statusUpdatedAtSec: UnixSeconds.make(SENT_AT),
      clientId: null,
      sentAt: UnixSeconds.make(SENT_AT),
      ...overrides,
    });

  const incomingScope = {
    contactId: "contact-1",
    delivery: "live",
    isOutgoing: false,
    isSelfAuthored: false,
    peerPubkey,
  } as const;

  it("re-encodes the snapshot into parseable offer content", () => {
    const info = getLinkyBankPaymentOfferInfo(
      bankOfferContentFromSnapshot(snapshot()),
    );

    expect(info).toEqual(
      expect.objectContaining({
        amountSat: 40_000,
        amountText: "500 Kč",
        offerId: "offer-1",
        offererPublicKey: peerPubkey,
        status: "offered",
        statusUpdatedAtSec: SENT_AT,
        text: "Zaplatíš za mě?",
      }),
    );
  });

  it("upserts the offer message and notifies for a live incoming offer", () => {
    const harness = createHarness();
    const now = Math.floor(Date.now() / 1e3);

    handleBankOfferSnapshotReceived(
      snapshot({
        initiatedAtSec: UnixSeconds.make(now),
        sentAt: UnixSeconds.make(now),
        statusUpdatedAtSec: UnixSeconds.make(now),
      }),
      incomingScope,
      harness.ctx,
    );

    expect(harness.onBankPaymentOfferMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact-1",
        direction: "in",
        id: `bank-payment-offer:${SNAPSHOT_RUMOR_ID}`,
        localOnly: true,
        pubkey: peerPubkey,
        rumorId: SNAPSHOT_RUMOR_ID,
        status: "sent",
        wrapId: SNAPSHOT_RUMOR_ID,
      }),
    );
    expect(harness.pushToast).toHaveBeenCalledWith("Alice: Zaplatíš za mě?");
    expect(harness.maybeShowPwaNotification).toHaveBeenCalledWith(
      "Alice",
      "Zaplatíš za mě?",
      SNAPSHOT_RUMOR_ID,
    );
  });

  it("upserts without notifying on backfill", () => {
    const harness = createHarness();
    const now = Math.floor(Date.now() / 1e3);

    handleBankOfferSnapshotReceived(
      snapshot({
        initiatedAtSec: UnixSeconds.make(now),
        sentAt: UnixSeconds.make(now),
        statusUpdatedAtSec: UnixSeconds.make(now),
      }),
      { ...incomingScope, delivery: "backfill" },
      harness.ctx,
    );

    expect(harness.onBankPaymentOfferMessage).toHaveBeenCalledTimes(1);
    expect(harness.pushToast).not.toHaveBeenCalled();
    expect(harness.maybeShowPwaNotification).not.toHaveBeenCalled();
  });

  it("skips expired offers entirely", () => {
    const harness = createHarness();

    handleBankOfferSnapshotReceived(
      snapshot({
        expiresAtSec: UnixSeconds.make(SENT_AT + 60),
      }),
      incomingScope,
      harness.ctx,
    );

    expect(harness.onBankPaymentOfferMessage).not.toHaveBeenCalled();
    expect(harness.pushToast).not.toHaveBeenCalled();
  });

  it("notifies the offerer of a decline and opens the contact chat from the toast", () => {
    const harness = createHarness();

    handleBankOfferSnapshotReceived(
      snapshot({ status: "declined" }),
      { ...incomingScope, isOutgoing: true },
      harness.ctx,
    );

    expect(harness.onBankPaymentOfferMessage).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "out" }),
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

  it("suppresses self-authored snapshots' notifications but still upserts", () => {
    const harness = createHarness();
    const now = Math.floor(Date.now() / 1e3);

    handleBankOfferSnapshotReceived(
      snapshot({
        initiatedAtSec: UnixSeconds.make(now),
        sentAt: UnixSeconds.make(now),
        statusUpdatedAtSec: UnixSeconds.make(now),
      }),
      { ...incomingScope, isSelfAuthored: true },
      harness.ctx,
    );

    expect(harness.onBankPaymentOfferMessage).toHaveBeenCalledTimes(1);
    expect(harness.pushToast).not.toHaveBeenCalled();
    expect(harness.maybeShowPwaNotification).not.toHaveBeenCalled();
  });
});
