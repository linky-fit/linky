import { encodeNprofile, Pubkey } from "@linky/linkstr";
import {
  buildCashuPaymentRequestMessage,
  parseCashuPaymentRequestMessage,
} from "../../lib/paymentRequestMessage";
import { isCurrentChatPaymentRequest } from "../../lib/chatPaymentRequestAuthorization";
import * as Evolu from "@evolu/common";
import {
  Amount,
  CurrencyUnit,
  InsufficientFunds,
  MintUrl,
  NonNegativeAmount,
  SendReceipt,
  ReceiveReceipt,
  OperationId,
  TokenText,
} from "@linky/linkshu";
import {
  ClientId,
  EnqueueReceipt,
  OutboxJobId,
  OutboxRef,
  PaymentNoticeReceipt,
  RelayUrl,
  RumorId,
  UnixSeconds,
  WrapDelivery,
  WrapId,
} from "@linky/linkstr";
import { Either, Exit } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { buildCashuToken } from "../../../testUtils/cashuToken";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type {
  CashuTransferLifecycle,
  SendCashuToken,
} from "../composition/useLinkshuComposition";
import type {
  EnqueueOutbox,
  SendPaymentNotice,
} from "./publishCashuMessagePayment";
import type { ContactRowLike, LocalNostrMessage } from "../../types/appTypes";

const { enqueueOutboxMock, navigateToMock, sendPaymentNoticeMock } = vi.hoisted(
  () => ({
    enqueueOutboxMock: vi.fn<EnqueueOutbox>(),
    navigateToMock: vi.fn(),
    sendPaymentNoticeMock: vi.fn<SendPaymentNotice>(),
  }),
);

vi.mock("../../../hooks/useRouting", () => ({
  navigateTo: navigateToMock,
}));

vi.mock("@linky/linkstr-react", () => ({
  enqueueOutboxAtom: "enqueueOutboxAtom",
  sendPaymentNoticeAtom: "sendPaymentNoticeAtom",
  useAtomSet: (atom: unknown) =>
    atom === "enqueueOutboxAtom" ? enqueueOutboxMock : sendPaymentNoticeMock,
}));

import { usePayContactWithCashuMessage } from "./usePayContactWithCashuMessage";

const CONTACT_ID = Evolu.createIdFromString<"Contact">("contact");
const MINT_URL = "https://mint.example";

const currentNpub = nip19.npubEncode(getPublicKey(createSecretKey(1)));
const contactNpub = nip19.npubEncode(getPublicKey(createSecretKey(2)));

const sendTokenText = buildCashuToken({
  amounts: [600],
  mint: MINT_URL,
  unit: "sat",
});

const sendReceipt = new SendReceipt({
  operationId: OperationId.make("send-op"),
  tokenText: TokenText.make(sendTokenText),
  proofs: [],
  mint: MintUrl.make(MINT_URL),
  unit: CurrencyUnit.make("sat"),
  amount: Amount.make(600),
  changeAmount: NonNegativeAmount.make(400),
  feePaid: NonNegativeAmount.make(0),
});

const sentAt = UnixSeconds.make(1_730_000_000);

const delivery = (wrapIdHex: string, accepted: boolean): WrapDelivery =>
  new WrapDelivery({
    wrapId: WrapId.make(wrapIdHex),
    acceptedBy: accepted ? [RelayUrl.make("wss://relay.example")] : [],
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
    recipientCopy: delivery("cc".repeat(32), true),
  });

const fallbackClientId = ClientId.make("fallback-client");

type PayContact = ReturnType<
  typeof usePayContactWithCashuMessage<ContactRowLike>
>;
type PayParams = Parameters<
  typeof usePayContactWithCashuMessage<ContactRowLike>
>[0];

interface SetupOptions {
  appendLocalNostrMessage?: PayParams["appendLocalNostrMessage"];
  enqueuePendingPayment?: PayParams["enqueuePendingPayment"];
  forget?: CashuTransferLifecycle["forget"];
  returnToWallet?: CashuTransferLifecycle["returnToWallet"];
  logPaymentEvent?: PayParams["logPaymentEvent"];
  nostrMessagesLocal?: LocalNostrMessage[];
  pushToast?: PayParams["pushToast"];
  sendCashuToken?: SendCashuToken;
  setStatus?: PayParams["setStatus"];
  showPaidOverlay?: PayParams["showPaidOverlay"];
  updateLocalNostrMessage?: PayParams["updateLocalNostrMessage"];
}

const setup = async (options: SetupOptions = {}) => {
  let payContact: PayContact | null = null;
  const enqueuePendingPayment =
    options.enqueuePendingPayment ??
    vi.fn<PayParams["enqueuePendingPayment"]>();
  const forget =
    options.forget ??
    vi.fn<CashuTransferLifecycle["forget"]>(async () =>
      Either.right(undefined),
    );
  const logPaymentEvent =
    options.logPaymentEvent ?? vi.fn<PayParams["logPaymentEvent"]>();
  const pushToast = options.pushToast ?? vi.fn<PayParams["pushToast"]>();
  const setStatus = options.setStatus ?? vi.fn<PayParams["setStatus"]>();
  const showPaidOverlay =
    options.showPaidOverlay ?? vi.fn<PayParams["showPaidOverlay"]>();
  const updateLocalNostrMessage =
    options.updateLocalNostrMessage ??
    vi.fn<PayParams["updateLocalNostrMessage"]>();
  const sendCashuToken =
    options.sendCashuToken ?? vi.fn(async () => Either.right(sendReceipt));

  const returnToWallet =
    options.returnToWallet ??
    vi.fn<CashuTransferLifecycle["returnToWallet"]>(async () =>
      Either.right(
        new ReceiveReceipt({
          operationId: sendReceipt.operationId,
          tokenText: sendReceipt.tokenText,
          mint: sendReceipt.mint,
          unit: sendReceipt.unit,
          amount: sendReceipt.amount,
        }),
      ),
    );
  const cashuTransferLifecycle: CashuTransferLifecycle = {
    reclaim: vi.fn<CashuTransferLifecycle["reclaim"]>(),
    checkIssuedClaims: vi.fn<CashuTransferLifecycle["checkIssuedClaims"]>(),
    forget,
    importLegacyRows: vi.fn<CashuTransferLifecycle["importLegacyRows"]>(),
    importOperation: vi.fn<CashuTransferLifecycle["importOperation"]>(),
    importProofs: vi.fn<CashuTransferLifecycle["importProofs"]>(),
    markExternalized: vi.fn<CashuTransferLifecycle["markExternalized"]>(),
    markIssued: vi.fn<CashuTransferLifecycle["markIssued"]>(),
    returnToWallet,
  };

  const Harness = () => {
    const pay = usePayContactWithCashuMessage<ContactRowLike>({
      appendLocalNostrMessage:
        options.appendLocalNostrMessage ?? (() => "local-message"),
      cashuBalance: 1_000,
      cashuTransferLifecycle,
      currentNpub,
      currentNsec: "nsec-test",
      defaultMintUrl: MINT_URL,
      enqueuePendingPayment,
      formatDisplayedAmountParts: (amountSat) => ({
        approxPrefix: "",
        amountText: String(amountSat),
        unitLabel: "sat",
      }),
      logPayStep: vi.fn(),
      logPaymentEvent,
      nostrMessagesLocal: options.nostrMessagesLocal ?? [],
      payWithCashuEnabled: true,
      pushToast,
      sendCashuToken,
      setContactsOnboardingHasPaid: vi.fn(),
      setStatus,
      showPaidOverlay,
      t: (key) => key,
      updateLocalNostrMessage,
      walletMintBalances: [{ amount: 1_000, mint: MINT_URL }],
    });

    React.useEffect(() => {
      payContact = pay;
    }, [pay]);
    return null;
  };

  const { root } = await renderIntoDocument(<Harness />);

  return {
    enqueuePendingPayment,
    forget,
    getPay: () => payContact,
    returnToWallet,
    logPaymentEvent,
    pushToast,
    root,
    sendCashuToken,
    setStatus,
    showPaidOverlay,
    updateLocalNostrMessage,
  };
};

const payAlice = async (
  harness: Awaited<ReturnType<typeof setup>>,
  isPaymentAuthorized?: () => boolean,
) => {
  let result: Awaited<ReturnType<PayContact>> | null = null;
  await act(async () => {
    result =
      (await harness.getPay()?.({
        amountSat: 600,
        ...(isPaymentAuthorized ? { isPaymentAuthorized } : {}),
        contact: {
          id: CONTACT_ID,
          name: "Alice",
          npub: contactNpub,
        },
      })) ?? null;
  });
  return result;
};

describe("usePayContactWithCashuMessage", () => {
  afterEach(() => {
    enqueueOutboxMock.mockReset();
    navigateToMock.mockReset();
    sendPaymentNoticeMock.mockReset();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const reviewRequest = () => {
    const pubkey = Pubkey.make(getPublicKey(createSecretKey(2)));
    const content = buildCashuPaymentRequestMessage({
      amount: 600,
      mintUrls: [],
      recipientNprofile: encodeNprofile(pubkey, []),
      requestId: "request-1",
    });
    const reviewed: LocalNostrMessage = {
      id: "request",
      content,
      pubkey,
      contactId: CONTACT_ID,
      direction: "in",
      createdAtSec: sentAt,
      rumorId: "a".repeat(64),
      wrapId: "b".repeat(64),
    };
    const request = parseCashuPaymentRequestMessage(content);
    if (!request) throw new Error("invalid fixture request");
    const messages = [{ ...reviewed }];
    const recipient = { id: CONTACT_ID, npub: contactNpub };
    return {
      messages,
      reviewed,
      request,
      recipient,
      isCurrent: () =>
        isCurrentChatPaymentRequest(
          reviewed,
          request,
          recipient,
          messages,
          recipient,
        ),
    };
  };

  it("rejects an old Pay callback after the request was edited", async () => {
    const review = reviewRequest();
    review.messages[0] = {
      ...review.reviewed,
      isEdited: true,
      content: "changed",
    };
    const harness = await setup();
    expect(await payAlice(harness, review.isCurrent)).toMatchObject({
      ok: false,
      queued: false,
    });
    expect(harness.sendCashuToken).not.toHaveBeenCalled();
    expect(enqueueOutboxMock).not.toHaveBeenCalled();
    await act(async () => harness.root.unmount());
  });

  it("rejects changed recipients and amount arguments even with the original request encoding", () => {
    const review = reviewRequest();
    expect(review.isCurrent()).toBe(true);
    expect(
      isCurrentChatPaymentRequest(
        review.reviewed,
        { ...review.request, amount: 60_000 },
        review.recipient,
        review.messages,
        review.recipient,
      ),
    ).toBe(false);
    expect(
      isCurrentChatPaymentRequest(
        review.reviewed,
        review.request,
        review.recipient,
        review.messages,
        { ...review.recipient, npub: currentNpub },
      ),
    ).toBe(false);
  });

  it("returns minted proofs without publishing when a request changes during token creation", async () => {
    const review = reviewRequest();
    const harness = await setup({
      sendCashuToken: vi.fn(async () => {
        review.messages[0] = {
          ...review.reviewed,
          isEdited: true,
          content: "changed while mint was responding",
        };
        return Either.right(sendReceipt);
      }),
    });
    expect(await payAlice(harness, review.isCurrent)).toMatchObject({
      ok: false,
      queued: false,
    });
    expect(harness.returnToWallet).toHaveBeenCalledWith(
      sendReceipt.operationId,
    );
    expect(harness.forget).not.toHaveBeenCalled();
    expect(enqueueOutboxMock).not.toHaveBeenCalled();
    expect(harness.showPaidOverlay).not.toHaveBeenCalled();
    expect(harness.logPaymentEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
    await act(async () => harness.root.unmount());
  });

  it("returns funds when the approved recipient changes during minting", async () => {
    const approvedPubkey = getPublicKey(createSecretKey(2));
    let currentPubkey = approvedPubkey;
    const harness = await setup({
      sendCashuToken: vi.fn(async () => {
        currentPubkey = getPublicKey(createSecretKey(3));
        return Either.right(sendReceipt);
      }),
    });
    expect(
      await payAlice(harness, () => currentPubkey === approvedPubkey),
    ).toMatchObject({ ok: false, queued: false });
    expect(harness.returnToWallet).toHaveBeenCalledWith(
      sendReceipt.operationId,
    );
    expect(harness.forget).not.toHaveBeenCalled();
    expect(enqueueOutboxMock).not.toHaveBeenCalled();
    expect(harness.showPaidOverlay).not.toHaveBeenCalled();
    await act(async () => harness.root.unmount());
  });

  it("retains the pending transfer if reclamation fails after authorization is lost", async () => {
    let current = true;
    const harness = await setup({
      sendCashuToken: vi.fn(async () => {
        current = false;
        return Either.right(sendReceipt);
      }),
      returnToWallet: vi.fn(async () => {
        throw new Error("mint unavailable");
      }),
    });
    expect(await payAlice(harness, () => current)).toMatchObject({ ok: false });
    expect(harness.returnToWallet).toHaveBeenCalledWith(
      sendReceipt.operationId,
    );
    expect(harness.forget).not.toHaveBeenCalled();
    expect(enqueueOutboxMock).not.toHaveBeenCalled();
    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "mint unavailable" }),
    );
    await act(async () => harness.root.unmount());
  });

  it("queues the reviewed amount and recipient offline without re-reading later edits", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const review = reviewRequest();
    const harness = await setup();
    expect(await payAlice(harness, review.isCurrent)).toMatchObject({
      ok: true,
      queued: true,
    });
    review.messages[0] = {
      ...review.reviewed,
      isEdited: true,
      content: "changed after queueing",
    };
    expect(harness.enqueuePendingPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountSat: 600, contactId: CONTACT_ID }),
    );
    expect(harness.sendCashuToken).not.toHaveBeenCalled();
    await act(async () => harness.root.unmount());
  });

  it("sends via linkshu, publishes, forgets the delivered row, finalizes transaction", async () => {
    const operations: string[] = [];
    const sendCashuToken = vi.fn<SendCashuToken>(async (args) => {
      operations.push(`send:${args.mint}:${args.amountSat}:${args.produceAs}`);
      return Either.right(sendReceipt);
    });
    enqueueOutboxMock.mockImplementation(async (input) => {
      operations.push("enqueue");
      return Exit.succeed(
        enqueueReceipt(input.op.draft.clientId ?? fallbackClientId, input.ref),
      );
    });
    sendPaymentNoticeMock.mockImplementation(async (draft) =>
      Exit.succeed(noticeReceipt(draft.clientId ?? fallbackClientId)),
    );
    const forget = vi.fn(async (operationId: string) => {
      operations.push(`forget:${operationId}`);
      return Either.right(undefined);
    });
    const logPaymentEvent = vi.fn(() => {
      operations.push("transaction");
    });
    const harness = await setup({ forget, logPaymentEvent, sendCashuToken });

    const result = await payAlice(harness, reviewRequest().isCurrent);

    expect(result).toEqual({ ok: true, queued: false });
    expect(operations).toEqual([
      `send:${MINT_URL}:600:pending`,
      "enqueue",
      "forget:send-op",
      "transaction",
    ]);
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "complete", status: "ok" }),
    );
    expect(sendPaymentNoticeMock).toHaveBeenCalledOnce();
    expect(navigateToMock).toHaveBeenCalledWith({
      id: CONTACT_ID,
      route: "chat",
    });

    await act(async () => harness.root.unmount());
  });

  it("queues an offline placeholder without swapping or publishing", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const appendLocalNostrMessage = vi.fn(() => "offline-message");
    const sendCashuToken = vi.fn<SendCashuToken>();
    const harness = await setup({ appendLocalNostrMessage, sendCashuToken });

    const result = await payAlice(harness);

    expect(result).toEqual({ ok: true, queued: true });
    expect(sendCashuToken).not.toHaveBeenCalled();
    expect(enqueueOutboxMock).not.toHaveBeenCalled();
    expect(sendPaymentNoticeMock).not.toHaveBeenCalled();
    expect(harness.enqueuePendingPayment).toHaveBeenCalledWith({
      amountSat: 600,
      contactId: CONTACT_ID,
      recipientPubkey: Pubkey.make(getPublicKey(createSecretKey(2))),
      messageId: "offline-message",
    });
    expect(appendLocalNostrMessage).toHaveBeenCalledOnce();

    await act(async () => harness.root.unmount());
  });

  it("keeps the pending row and returns queued on enqueue failure", async () => {
    enqueueOutboxMock.mockResolvedValue(
      Exit.fail({ _tag: "LinkstrNotConfigured" }),
    );
    const pushToast = vi.fn<PayParams["pushToast"]>();
    const showPaidOverlay = vi.fn<PayParams["showPaidOverlay"]>();
    const harness = await setup({ pushToast, showPaidOverlay });

    const result = await payAlice(harness);

    expect(result).toEqual({ ok: true, queued: true });
    expect(harness.forget).not.toHaveBeenCalled();
    expect(sendPaymentNoticeMock).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith("payFailed: LinkstrNotConfigured");
    expect(showPaidOverlay).toHaveBeenCalledWith("paidQueuedTo");

    await act(async () => harness.root.unmount());
  });

  it("reports insufficient funds without publishing when the send fails", async () => {
    const sendCashuToken = vi.fn<SendCashuToken>(async () =>
      Either.left(
        new InsufficientFunds({
          mint: MintUrl.make(MINT_URL),
          required: Amount.make(600),
          available: NonNegativeAmount.make(10),
        }),
      ),
    );
    const setStatus = vi.fn<PayParams["setStatus"]>();
    const harness = await setup({ sendCashuToken, setStatus });

    const result = await payAlice(harness);

    expect(result).toEqual({
      error: "Insufficient funds (need 600, have 10)",
      ok: false,
      queued: false,
    });
    expect(setStatus).toHaveBeenCalledWith("payInsufficient");
    expect(enqueueOutboxMock).not.toHaveBeenCalled();
    expect(harness.forget).not.toHaveBeenCalled();

    await act(async () => harness.root.unmount());
  });
});
