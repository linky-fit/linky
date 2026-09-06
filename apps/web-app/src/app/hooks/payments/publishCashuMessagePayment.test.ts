import * as Evolu from "@evolu/common";
import {
  ClientId,
  EnqueueReceipt,
  NoRelayReachable,
  OutboxJobId,
  OutboxRef,
  PaymentNoticeDraft,
  PaymentNoticeReceipt,
  RelayUrl,
  RumorId,
  TokenMessageDraft,
  UnixSeconds,
  WrapDelivery,
  WrapId,
} from "@linky/linkstr";
import { Exit } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import { describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { buildCashuToken } from "../../../testUtils/cashuToken";
import type { LocalNostrMessage } from "../../types/appTypes";
import { publishCashuMessagePayment } from "./publishCashuMessagePayment";
import type {
  EnqueueOutbox,
  SendPaymentNotice,
} from "./publishCashuMessagePayment";

const privateKey = createSecretKey(1);
const contactPrivateKey = createSecretKey(2);
const myPublicKey = getPublicKey(privateKey);
const currentNpub = nip19.npubEncode(myPublicKey);
const contactPublicKey = getPublicKey(contactPrivateKey);
const contactNpub = nip19.npubEncode(contactPublicKey);
const contactId = Evolu.createIdFromString<"Contact">("contact");

const tokenText = buildCashuToken({ amounts: [100], unit: "sat" });

const rootId = "ab".repeat(32);
const replyId = "cd".repeat(32);
const relay = RelayUrl.make("wss://relay.example");
const sentAt = UnixSeconds.make(1_730_000_000);

const delivery = (wrapIdHex: string): WrapDelivery =>
  new WrapDelivery({
    wrapId: WrapId.make(wrapIdHex),
    acceptedBy: [relay],
    rejectedBy: [],
  });

const enqueueReceipt = (clientId: ClientId, ref: OutboxRef): EnqueueReceipt =>
  new EnqueueReceipt({
    jobId: OutboxJobId.make("job-1"),
    ref,
    rumorId: RumorId.make("12".repeat(32)),
    clientId,
    sentAt,
  });

const noticeReceipt = (clientId: ClientId): PaymentNoticeReceipt =>
  new PaymentNoticeReceipt({
    rumorId: RumorId.make("34".repeat(32)),
    clientId,
    sentAt,
    recipientCopy: delivery("cc".repeat(32)),
  });

const createArgs = () => {
  const ids = ["token-client", "notice-client"];
  const nostrMessagesLocal: LocalNostrMessage[] = [];
  return {
    appendLocalNostrMessage: vi.fn(() => "new-local-message"),
    batches: [
      {
        amount: 100,
        mint: "https://mint.example",
        token: tokenText,
        unit: "sat",
      },
    ],
    contactId,
    contactNpub,
    currentNpub,
    dependencies: {
      makeId: () => ids.shift() ?? "unexpected-client",
      nowSec: () => 1_730_000_000,
    },
    enqueueOutbox: vi
      .fn<EnqueueOutbox>()
      .mockImplementation((input) =>
        Promise.resolve(
          Exit.succeed(
            enqueueReceipt(
              input.op.draft.clientId ?? ClientId.make("token-client"),
              input.ref,
            ),
          ),
        ),
      ),
    logPayStep: vi.fn(),
    nostrMessagesLocal,
    pendingMessageId: null,
    sendPaymentNotice: vi
      .fn<SendPaymentNotice>()
      .mockImplementation((draft) =>
        Promise.resolve(
          Exit.succeed(
            noticeReceipt(draft.clientId ?? ClientId.make("notice-client")),
          ),
        ),
      ),
    updateLocalNostrMessage: vi.fn(),
  };
};

describe("publishCashuMessagePayment", () => {
  it("enqueues the token draft with reply context and reuses one pending message", async () => {
    const args = createArgs();
    const pendingMessage: LocalNostrMessage = {
      contactId: contactId,
      content: "queued",
      createdAtSec: 1,
      direction: "out",
      id: "pending-message",
      pubkey: "",
      rumorId: null,
      status: "pending",
      wrapId: "pending:old",
    };

    const result = await publishCashuMessagePayment({
      ...args,
      nostrMessagesLocal: [pendingMessage],
      pendingMessageId: "pending-message",
      replyContext: {
        replyToContent: "original",
        replyToId: replyId,
        rootMessageId: rootId,
      },
    });

    expect(args.appendLocalNostrMessage).not.toHaveBeenCalled();
    expect(args.updateLocalNostrMessage).toHaveBeenNthCalledWith(
      1,
      "pending-message",
      expect.objectContaining({
        clientId: "token-client",
        content: tokenText,
        status: "pending",
      }),
    );
    expect(args.updateLocalNostrMessage).toHaveBeenNthCalledWith(
      2,
      "pending-message",
      {
        createdAtSec: sentAt,
        rumorId: "12".repeat(32),
      },
    );

    const input = args.enqueueOutbox.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      op: { _tag: "chat.token" },
      ref: "message:pending-message",
    });
    const draft = input?.op._tag === "chat.token" ? input.op.draft : undefined;
    expect(draft).toBeInstanceOf(TokenMessageDraft);
    expect(draft).toMatchObject({
      to: contactPublicKey,
      token: tokenText,
      clientId: "token-client",
      replyTo: replyId,
      root: rootId,
    });
    expect(result).toEqual({
      hasPendingMessages: false,
      paymentNoticeError: null,
      publishErrors: [],
      publishedTokenTexts: [tokenText],
      unpublishedTokenTexts: [],
    });
  });

  it.each([
    [
      "LinkstrNotConfigured",
      (args: ReturnType<typeof createArgs>) => {
        args.enqueueOutbox.mockResolvedValue(
          Exit.fail({ _tag: "LinkstrNotConfigured" }),
        );
      },
    ],
    [
      "relay unavailable",
      (args: ReturnType<typeof createArgs>) => {
        args.enqueueOutbox.mockRejectedValue(new Error("relay unavailable"));
      },
    ],
  ])(
    "keeps the local message pending and skips the notice on %s",
    async (expectedError, arrange) => {
      const args = createArgs();
      arrange(args);

      const result = await publishCashuMessagePayment(args);

      expect(args.appendLocalNostrMessage).toHaveBeenCalledOnce();
      expect(args.updateLocalNostrMessage).not.toHaveBeenCalled();
      expect(args.sendPaymentNotice).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        hasPendingMessages: true,
        publishErrors: [
          {
            clientId: "token-client",
            error: expectedError,
            token: tokenText,
          },
        ],
        publishedTokenTexts: [],
        unpublishedTokenTexts: [tokenText],
      });
    },
  );

  it("publishes a best-effort bank-offer payment notice after token success", async () => {
    const args = createArgs();
    args.sendPaymentNotice.mockImplementation((draft) =>
      Promise.resolve(
        Exit.fail(
          new NoRelayReachable({
            rumorId: RumorId.make("34".repeat(32)),
            clientId: draft.clientId ?? ClientId.make("notice-client"),
            sentAt,
            selfCopy: delivery("cc".repeat(32)),
            recipientCopy: new WrapDelivery({
              wrapId: WrapId.make("cc".repeat(32)),
              acceptedBy: [],
              rejectedBy: [],
            }),
          }),
        ),
      ),
    );

    const result = await publishCashuMessagePayment({
      ...args,
      paymentNoticeContext: "bank_payment_offer",
      paymentNoticeOfferId: "offer-1",
    });

    const draft = args.sendPaymentNotice.mock.calls[0]?.[0];
    expect(draft).toBeInstanceOf(PaymentNoticeDraft);
    expect(draft).toMatchObject({
      to: contactPublicKey,
      clientId: "notice-client",
      context: "bank_payment_offer",
      offerId: "offer-1",
    });
    expect(result).toMatchObject({
      hasPendingMessages: false,
      paymentNoticeError: "NoRelayReachable",
      publishedTokenTexts: [tokenText],
      unpublishedTokenTexts: [],
    });
  });
});
