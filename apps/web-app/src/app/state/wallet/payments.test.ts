import { createIdFromString } from "@linky-fit/linksync";
import {
  Amount,
  CurrencyUnit,
  InsufficientFunds,
  MeltReceipt,
  MintRejected,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  PaymentPending,
  QuoteId,
  ReceiveReceipt,
  SendReceipt,
  TokenText,
} from "@linky-fit/linkshu";
import {
  ClientId,
  EnqueueReceipt,
  OutboxJobId,
  PaymentNoticeReceipt,
  Pubkey,
  RelayUrl,
  RumorId,
  UnixSeconds,
  WrapDelivery,
  WrapId,
} from "@linky-fit/linkstr";
import { LinkstrNotConfigured } from "@linky-fit/linkstr-react";
import { Exit, Result } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LnurlPayInvoiceResult } from "../../../lnurlPay";
import { buildCashuToken } from "../../../testUtils/cashuToken";
import { makeLightningInvoice } from "../../../testUtils/lightningInvoice";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { walletBalancesOf } from "../../../testUtils/walletFakes";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import { NO_WRITE, type WriteOutcome } from "../../lib/storeWrite";
import type { CashuTransferLifecycle } from "../linkshu/commands";
import { makeWalletOps } from "./opQueue";
import {
  makePaymentsCommands,
  paymentResultOf,
  type ContactPayment,
  type PaymentsDeps,
} from "./payments";

const { fetchLnurlInvoiceForTarget } = vi.hoisted(() => ({
  fetchLnurlInvoiceForTarget:
    vi.fn<
      (
        target: string,
        amountSat: number,
        comment?: string,
      ) => Promise<LnurlPayInvoiceResult>
    >(),
}));
vi.mock("../../../lnurlPay", () => ({
  fetchLnurlInvoiceForTarget,
  inferLightningAddressFromLnurlTarget: (target: string) =>
    target.includes("@") ? target : null,
}));

const MINT_URL = "https://mint.example";
const FOREIGN = "https://foreign.example";
const CONTACT_ID = createIdFromString<"Contact">("contact");
const currentNpub = nip19.npubEncode(getPublicKey(createSecretKey(1)));
const contactPubkey = Pubkey.make(getPublicKey(createSecretKey(2)));
const contactNpub = nip19.npubEncode(contactPubkey);
const sentAt = UnixSeconds.make(1_730_000_000);
const fallbackClientId = ClientId.make("fallback-client");

const meltReceipt = (paidAmount: number) =>
  new MeltReceipt({
    mint: MintUrl.make(MINT_URL),
    quoteId: QuoteId.make("quote-1"),
    paidAmount: Amount.make(paidAmount),
    feeReserve: NonNegativeAmount.make(2),
    feePaid: NonNegativeAmount.make(1),
    changeAmount: NonNegativeAmount.make(1),
  });

const pending = (amount: number) =>
  new PaymentPending({
    mint: MintUrl.make(MINT_URL),
    quoteId: QuoteId.make("quote-1"),
    operationId: OperationId.make("op-1"),
    amount: Amount.make(amount),
  });

const insufficientFunds = (required: number, available: number) =>
  new InsufficientFunds({
    mint: MintUrl.make(MINT_URL),
    required: Amount.make(required),
    available: NonNegativeAmount.make(available),
  });

const sendReceipt = new SendReceipt({
  operationId: OperationId.make("send-op"),
  tokenText: TokenText.make(
    buildCashuToken({ amounts: [600], mint: MINT_URL, unit: "sat" }),
  ),
  proofs: [],
  mint: MintUrl.make(MINT_URL),
  unit: CurrencyUnit.make("sat"),
  amount: Amount.make(600),
  lockTo: null,
  changeAmount: NonNegativeAmount.make(400),
  feePaid: NonNegativeAmount.make(0),
});

const transferLifecycle = (
  overrides: Partial<CashuTransferLifecycle> = {},
): CashuTransferLifecycle => ({
  reclaim: vi.fn(),
  checkIssuedClaims: vi.fn(),
  forget: vi.fn(async () => Result.succeed(undefined)),
  importLegacyRows: vi.fn(),
  importOperation: vi.fn(),
  importProofs: vi.fn(),
  markExternalized: vi.fn(),
  markIssued: vi.fn(),
  returnToWallet: vi.fn(async () =>
    Result.succeed(
      new ReceiveReceipt({
        operationId: sendReceipt.operationId,
        tokenText: sendReceipt.tokenText,
        mint: sendReceipt.mint,
        unit: sendReceipt.unit,
        amount: sendReceipt.amount,
      }),
    ),
  ),
  ...overrides,
});

const delivered = (wrapIdHex: string) =>
  new WrapDelivery({
    wrapId: WrapId.make(wrapIdHex),
    acceptedBy: [RelayUrl.make("wss://relay.example")],
    rejectedBy: [],
  });

const chatWrites = (
  overrides: Partial<PaymentsDeps["chat"]> = {},
): PaymentsDeps["chat"] => ({
  appendLocalNostrMessage: vi.fn(() => ({
    id: "local-message",
    written: NO_WRITE,
  })),
  updateLocalNostrMessage: vi.fn(() => NO_WRITE),
  latestMessages: () => [],
  enqueuePendingPayment: vi.fn(),
  ...overrides,
});

const setup = ({
  balances = { [MINT_URL]: 1_000 },
  chat = chatWrites(),
  online = true,
  lifecycle = transferLifecycle(),
  ...overrides
}: {
  balances?: Record<string, number>;
  chat?: PaymentsDeps["chat"];
  online?: boolean;
  lifecycle?: CashuTransferLifecycle;
} & Partial<
  Pick<PaymentsDeps["linkshu"], "meltCashuInvoice" | "sendCashuToken">
> = {}) => {
  const ops = makeWalletOps(() => {});
  const linkshu = {
    cashuTransferLifecycle: lifecycle,
    meltCashuInvoice: vi.fn<PaymentsDeps["linkshu"]["meltCashuInvoice"]>(
      overrides.meltCashuInvoice ??
        (async () => Result.succeed(meltReceipt(40))),
    ),
    readWalletBalances: vi.fn(async () => walletBalancesOf(balances)),
    sendCashuToken: vi.fn<PaymentsDeps["linkshu"]["sendCashuToken"]>(
      overrides.sendCashuToken ?? (async () => Result.succeed(sendReceipt)),
    ),
  };
  const linkstr = {
    enqueueOutbox: vi.fn<PaymentsDeps["linkstr"]["enqueueOutbox"]>(
      async (input) =>
        Exit.succeed(
          new EnqueueReceipt({
            jobId: OutboxJobId.make("job-1"),
            ref: input.ref,
            rumorId: RumorId.make("12".repeat(32)),
            clientId: input.op.draft.clientId ?? fallbackClientId,
            sentAt,
          }),
        ),
    ),
    sendPaymentNotice: vi.fn<PaymentsDeps["linkstr"]["sendPaymentNotice"]>(
      async (draft) =>
        Exit.succeed(
          new PaymentNoticeReceipt({
            rumorId: RumorId.make("34".repeat(32)),
            clientId: draft.clientId ?? fallbackClientId,
            sentAt,
            recipientCopy: delivered("cc".repeat(32)),
          }),
        ),
    ),
  };
  const logPaymentEvent = vi.fn<PaymentsDeps["logPaymentEvent"]>();
  const commands = makePaymentsCommands({
    allowHttpPost: false,
    allowTestMints: true,
    chat,
    defaultMint: MINT_URL,
    currentNpub,
    currentNsec: "nsec-test",
    isOnline: () => online,
    linkshu,
    linkstr,
    logPaymentEvent,
    ops,
  });
  return { commands, linkshu, linkstr, logPaymentEvent, ops };
};

const alicePayment = (
  overrides: Partial<ContactPayment> = {},
): ContactPayment => ({
  amountSat: 600,
  contact: { id: CONTACT_ID, name: "Alice", npub: contactNpub },
  offlineNotice: "queued for Alice",
  ...overrides,
});

const holdWallet = (ops: ReturnType<typeof makeWalletOps>) => {
  let release = () => {};
  const held = ops.runQueuedTask(
    () => new Promise<void>((resolve) => (release = resolve)),
  );
  return () => {
    release();
    return held;
  };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("fundsFor", () => {
  it("is covered when one mint holds the amount", async () => {
    const { commands } = setup();
    expect(await commands.fundsFor(600)).toEqual({ _tag: "Covered" });
  });

  it("asks for a move into the default mint when only that covers it", async () => {
    const { commands } = setup({ balances: { [MINT_URL]: 50, [FOREIGN]: 80 } });
    expect(await commands.fundsFor(100)).toEqual({
      _tag: "NeedsMintMove",
      fromMint: FOREIGN,
      toMint: MINT_URL,
    });
  });

  it("is insufficient when no move covers it or the request refuses the default mint", async () => {
    const { commands } = setup({ balances: { [MINT_URL]: 50, [FOREIGN]: 80 } });
    expect(await commands.fundsFor(200)).toEqual({ _tag: "Insufficient" });
    expect(await commands.fundsFor(100, { acceptedMints: [FOREIGN] })).toEqual({
      _tag: "Insufficient",
    });
  });
});

describe("payLightningInvoice", () => {
  it("pays through linkshu Melt and records the receipt", async () => {
    const { commands, linkshu, logPaymentEvent } = setup();
    const onSending = vi.fn();

    const outcome = await commands.payLightningInvoice(" lnbc-mock-invoice ", {
      onSending,
    });

    expect(outcome).toEqual({ _tag: "Paid", receipt: meltReceipt(40) });
    expect(linkshu.meltCashuInvoice).toHaveBeenCalledWith({
      invoice: "lnbc-mock-invoice",
      mint: MINT_URL,
    });
    expect(onSending).toHaveBeenCalledOnce();
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 40,
        fee: 1,
        method: "lightning_invoice",
        mint: MINT_URL,
        paymentType: "lightning",
        phase: "complete",
        status: "ok",
      }),
    );
  });

  it("reports a typed melt failure with its detail", async () => {
    const { commands, logPaymentEvent } = setup({
      meltCashuInvoice: async () =>
        Result.fail(
          new MintRejected({
            mint: MintUrl.make(MINT_URL),
            code: null,
            detail: "boom",
          }),
        ),
    });

    expect(await commands.payLightningInvoice("lnbc-mock-invoice")).toEqual({
      _tag: "Failed",
      detail: "Mint rejected the token: boom",
    });
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Mint rejected the token: boom",
        phase: "melt",
        status: "error",
      }),
    );
  });

  it("records an unsettled melt as a pending payment keyed by its quote", async () => {
    const { commands, logPaymentEvent } = setup({
      meltCashuInvoice: async () => Result.fail(pending(40)),
    });

    expect(await commands.payLightningInvoice("lnbc-mock-invoice")).toEqual({
      _tag: "Pending",
      pending: pending(40),
    });
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 40,
        details: {
          lightningInvoice: "lnbc-mock-invoice",
          meltQuoteId: "quote-1",
        },
        phase: "melt",
        status: "ok",
      }),
    );
  });

  it("asks for a mint move when the invoice needs more than one mint holds", async () => {
    const { commands, linkshu } = setup({
      balances: { [MINT_URL]: 1_500, [FOREIGN]: 1_000 },
    });

    expect(await commands.payLightningInvoice(makeLightningInvoice())).toEqual({
      _tag: "NeedsMintMove",
      fromMint: FOREIGN,
      toMint: MINT_URL,
    });
    expect(linkshu.meltCashuInvoice).not.toHaveBeenCalled();
  });

  it("is insufficient with an empty wallet and ignores an empty invoice", async () => {
    const { commands } = setup({ balances: {} });
    expect(await commands.payLightningInvoice("lnbc-mock-invoice")).toEqual({
      _tag: "Insufficient",
    });
    expect(await commands.payLightningInvoice("  ")).toEqual({
      _tag: "Invalid",
    });
  });

  it("gives each of two concurrent payments its own result or Busy", async () => {
    let settle = () => {};
    const { commands, linkshu } = setup({
      meltCashuInvoice: () =>
        new Promise((resolve) => {
          settle = () => resolve(Result.succeed(meltReceipt(40)));
        }),
    });

    const first = commands.payLightningInvoice("lnbc-first");
    await vi.waitFor(() => expect(linkshu.meltCashuInvoice).toHaveBeenCalled());
    const second = await commands.payLightningInvoice("lnbc-second");
    settle();

    expect(second).toEqual({ _tag: "Busy" });
    expect(await first).toEqual({ _tag: "Paid", receipt: meltReceipt(40) });
    expect(linkshu.meltCashuInvoice).toHaveBeenCalledTimes(1);
  });
});

describe("payLightningAddress", () => {
  const invoiceFor = (amountSat: number): LnurlPayInvoiceResult => ({
    lightningAddress: "alice@example.com",
    pr: `lnbc-mock-${amountSat}`,
    successAction: null,
  });

  it("stops the amount ladder on an unsettled melt and records it pending", async () => {
    fetchLnurlInvoiceForTarget.mockImplementation(async (_target, amount) =>
      invoiceFor(amount),
    );
    const { commands, linkshu, logPaymentEvent } = setup({
      meltCashuInvoice: async () => Result.fail(pending(40)),
    });

    const outcome = await commands.payLightningAddress({
      lnAddress: "alice@example.com",
      amountSat: 40,
      contact: null,
    });

    expect(outcome).toEqual({ _tag: "Pending", pending: pending(40) });
    expect(linkshu.meltCashuInvoice).toHaveBeenCalledTimes(1);
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: {
          lightningAddress: "alice@example.com",
          lightningInvoice: "lnbc-mock-40",
          meltQuoteId: "quote-1",
        },
        method: "lightning_address",
        paymentType: "lightning",
        phase: "melt",
      }),
    );
  });

  it("sends the note as the LNURL comment and types a contact's address as a contact payment", async () => {
    fetchLnurlInvoiceForTarget.mockResolvedValue(invoiceFor(40));
    const { commands, logPaymentEvent } = setup();

    const outcome = await commands.payLightningAddress({
      lnAddress: "alice@example.com",
      amountSat: 40,
      contact: { id: "contact-1", lnAddress: "alice@example.com" },
      comment: " thanks! ",
    });

    expect(outcome).toEqual({
      _tag: "Paid",
      receipt: meltReceipt(40),
      lightningAddress: "alice@example.com",
      successAction: null,
    });
    expect(fetchLnurlInvoiceForTarget).toHaveBeenCalledWith(
      "alice@example.com",
      40,
      "thanks!",
    );
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact-1",
        note: "thanks!",
        paymentType: "contact",
        status: "ok",
      }),
    );
  });

  it("degrades a full-balance amount until the melt fits", async () => {
    fetchLnurlInvoiceForTarget.mockImplementation(async (_target, amount) =>
      invoiceFor(amount),
    );
    // The mint needs amount + 3 sat of fees; only 97 sat or less fits into
    // the 100 sat balance.
    const { commands } = setup({
      balances: { [MINT_URL]: 100 },
      meltCashuInvoice: async ({ invoice }) => {
        const amount = Number(invoice.replace("lnbc-mock-", ""));
        return amount + 3 > 100
          ? Result.fail(insufficientFunds(amount + 3, 100))
          : Result.succeed(meltReceipt(amount));
      },
    });

    const outcome = await commands.payLightningAddress({
      lnAddress: "alice@example.com",
      amountSat: 100,
      contact: null,
    });

    expect(outcome).toMatchObject({ _tag: "Paid", receipt: meltReceipt(97) });
    expect(
      fetchLnurlInvoiceForTarget.mock.calls.map(([, amount]) => amount),
    ).toEqual([100, 99, 98, 97]);
  });

  it("stops on a non-retryable melt failure and logs the melt phase", async () => {
    fetchLnurlInvoiceForTarget.mockImplementation(async (_target, amount) =>
      invoiceFor(amount),
    );
    const { commands, linkshu, logPaymentEvent } = setup({
      meltCashuInvoice: async () =>
        Result.fail(
          new MintRejected({
            mint: MintUrl.make(MINT_URL),
            code: null,
            detail: "melt disabled",
          }),
        ),
    });

    expect(
      await commands.payLightningAddress({
        lnAddress: "alice@example.com",
        amountSat: 40,
        contact: null,
      }),
    ).toEqual({
      _tag: "Failed",
      detail: "Mint rejected the token: melt disabled",
    });
    expect(linkshu.meltCashuInvoice).toHaveBeenCalledTimes(1);
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        mint: MINT_URL,
        phase: "melt",
        status: "error",
      }),
    );
  });

  it("logs a failed invoice fetch in its own phase", async () => {
    fetchLnurlInvoiceForTarget.mockRejectedValue(new Error("no route"));
    const { commands, logPaymentEvent } = setup();

    expect(
      await commands.payLightningAddress({
        lnAddress: "alice@example.com",
        amountSat: 40,
        contact: null,
      }),
    ).toEqual({ _tag: "Failed", detail: "no route" });
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ mint: null, phase: "invoice_fetch" }),
    );
  });

  it("refuses an invalid amount and asks for a move when one mint is short", async () => {
    const { commands } = setup({ balances: { [MINT_URL]: 50, [FOREIGN]: 80 } });
    expect(
      await commands.payLightningAddress({
        lnAddress: "alice@example.com",
        amountSat: 0,
        contact: null,
      }),
    ).toEqual({ _tag: "InvalidAmount" });
    expect(
      await commands.payLightningAddress({
        lnAddress: "alice@example.com",
        amountSat: 100,
        contact: null,
      }),
    ).toEqual({ _tag: "NeedsMintMove", fromMint: FOREIGN, toMint: MINT_URL });
  });
});

describe("payContact", () => {
  it("sends via linkshu, publishes, forgets the delivered row, then records the payment", async () => {
    const operations: string[] = [];
    const lifecycle = transferLifecycle({
      forget: vi.fn(async (operationId: string) => {
        operations.push(`forget:${operationId}`);
        return Result.succeed(undefined);
      }),
    });
    const harness = setup({
      lifecycle,
      sendCashuToken: async (args) => {
        operations.push(
          `send:${args.mint}:${args.amountSat}:${args.produceAs}`,
        );
        return Result.succeed(sendReceipt);
      },
    });
    harness.linkstr.enqueueOutbox.mockImplementation(async (input) => {
      operations.push("enqueue");
      return Exit.succeed(
        new EnqueueReceipt({
          jobId: OutboxJobId.make("job-1"),
          ref: input.ref,
          rumorId: RumorId.make("12".repeat(32)),
          clientId: input.op.draft.clientId ?? fallbackClientId,
          sentAt,
        }),
      );
    });
    harness.logPaymentEvent.mockImplementation(() => {
      operations.push("transaction");
    });
    const onSending = vi.fn();

    const outcome = await harness.commands.payContact(
      alicePayment({ memo: " lunch " }),
      { onSending },
    );

    expect(outcome).toEqual({
      _tag: "Sent",
      receipt: sendReceipt,
      contactId: CONTACT_ID,
      queued: false,
      publishErrors: [],
    });
    expect(paymentResultOf(outcome)).toEqual({ ok: true, queued: false });
    expect(operations).toEqual([
      `send:${MINT_URL}:600:pending`,
      "enqueue",
      "forget:send-op",
      "transaction",
    ]);
    expect(harness.linkshu.sendCashuToken).toHaveBeenCalledWith(
      expect.objectContaining({ memo: "lunch" }),
    );
    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        note: "lunch",
        paymentType: "contact",
        phase: "complete",
      }),
    );
    expect(harness.linkstr.sendPaymentNotice).toHaveBeenCalledOnce();
    expect(onSending).toHaveBeenCalledOnce();
  });

  it("types a send as proxy for a bank offer and request for a payment request", async () => {
    const { commands, logPaymentEvent } = setup();

    await commands.payContact(
      alicePayment({
        paymentNoticeContext: "bank_payment_offer",
        paymentNoticeOfferId: "offer-1",
      }),
    );
    expect(logPaymentEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentType: "proxy", status: "ok" }),
    );

    await commands.payContact(alicePayment({ paymentRequestId: "request-1" }));
    expect(logPaymentEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentType: "request", status: "ok" }),
    );
  });

  it("keeps the pending row and reports queued on an enqueue failure", async () => {
    const { commands, linkshu, linkstr } = setup();
    linkstr.enqueueOutbox.mockResolvedValue(
      Exit.fail(new LinkstrNotConfigured()),
    );

    const outcome = await commands.payContact(alicePayment());

    expect(outcome).toMatchObject({
      _tag: "Sent",
      queued: true,
      publishErrors: ["LinkstrNotConfigured"],
    });
    expect(linkshu.cashuTransferLifecycle.forget).not.toHaveBeenCalled();
    expect(linkstr.sendPaymentNotice).not.toHaveBeenCalled();
  });

  it("refuses a payment whose approval changed before any token is made", async () => {
    const { commands, linkshu } = setup();

    const outcome = await commands.payContact(
      alicePayment({ isPaymentAuthorized: () => false }),
    );

    expect(outcome).toEqual({ _tag: "AuthorizationChanged" });
    expect(paymentResultOf(outcome)).toEqual({
      error: "payment authorization changed",
      ok: false,
      queued: false,
    });
    expect(linkshu.sendCashuToken).not.toHaveBeenCalled();
  });

  it("returns minted proofs without publishing when the approval changes during minting", async () => {
    let approved = true;
    const { commands, linkshu, linkstr, logPaymentEvent } = setup({
      sendCashuToken: async () => {
        approved = false;
        return Result.succeed(sendReceipt);
      },
    });

    expect(
      await commands.payContact(
        alicePayment({ isPaymentAuthorized: () => approved }),
      ),
    ).toEqual({ _tag: "AuthorizationChanged" });
    expect(linkshu.cashuTransferLifecycle.returnToWallet).toHaveBeenCalledWith(
      sendReceipt.operationId,
    );
    expect(linkshu.cashuTransferLifecycle.forget).not.toHaveBeenCalled();
    expect(linkstr.enqueueOutbox).not.toHaveBeenCalled();
    expect(logPaymentEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  it("keeps the pending transfer if returning it fails after the approval is lost", async () => {
    let approved = true;
    const { commands, linkshu, logPaymentEvent } = setup({
      lifecycle: transferLifecycle({
        returnToWallet: vi.fn(async () => {
          throw new Error("mint unavailable");
        }),
      }),
      sendCashuToken: async () => {
        approved = false;
        return Result.succeed(sendReceipt);
      },
    });

    await commands.payContact(
      alicePayment({ isPaymentAuthorized: () => approved }),
    );

    expect(linkshu.cashuTransferLifecycle.forget).not.toHaveBeenCalled();
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "mint unavailable" }),
    );
  });

  it("queues an offline payment behind its stored placeholder without swapping", async () => {
    let store: (outcome: WriteOutcome) => void = () => {};
    const stored = new Promise<WriteOutcome>((resolve) => (store = resolve));
    const chat = chatWrites({
      appendLocalNostrMessage: vi.fn(() => ({
        id: "offline-message",
        written: stored,
      })),
    });
    const { commands, linkshu } = setup({ chat, online: false });

    const paying = commands.payContact(alicePayment());
    await Promise.resolve();
    expect(chat.enqueuePendingPayment).not.toHaveBeenCalled();
    store({ ok: true });

    expect(await paying).toEqual({
      _tag: "QueuedOffline",
      contactId: CONTACT_ID,
    });
    expect(chat.appendLocalNostrMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "queued for Alice", localOnly: true }),
    );
    expect(chat.enqueuePendingPayment).toHaveBeenCalledWith({
      amountSat: 600,
      contactId: CONTACT_ID,
      recipientPubkey: contactPubkey,
      messageId: "offline-message",
    });
    expect(linkshu.sendCashuToken).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "reports an unstored message without claiming success, offline=%s",
    async (offline) => {
      const chat = chatWrites({
        appendLocalNostrMessage: () => ({
          id: "message",
          written: Promise.resolve({ ok: false, error: "storage unavailable" }),
        }),
      });
      const { commands, linkshu, linkstr } = setup({
        chat,
        online: !offline,
      });

      const outcome = await commands.payContact(alicePayment());

      expect(paymentResultOf(outcome)).toMatchObject({
        ok: false,
        queued: false,
        error: "storage unavailable",
      });
      expect(linkstr.enqueueOutbox).not.toHaveBeenCalled();
      expect(chat.enqueuePendingPayment).not.toHaveBeenCalled();
      expect(linkshu.cashuTransferLifecycle.forget).not.toHaveBeenCalled();
    },
  );

  it("reports insufficient funds from the send without publishing", async () => {
    const { commands, linkstr } = setup({
      sendCashuToken: async () => Result.fail(insufficientFunds(600, 10)),
    });

    const outcome = await commands.payContact(alicePayment());

    expect(outcome).toEqual({
      _tag: "Failed",
      detail: "Insufficient funds (need 600, have 10)",
      insufficient: true,
    });
    expect(paymentResultOf(outcome)).toEqual({
      error: "Insufficient funds (need 600, have 10)",
      ok: false,
      queued: false,
    });
    expect(linkstr.enqueueOutbox).not.toHaveBeenCalled();
  });

  it("keeps a payment no mint covers, a missing identity or a busy wallet retryable", async () => {
    const short = setup({ balances: { [MINT_URL]: 100 } });
    const insufficient = await short.commands.payContact(alicePayment());
    expect(insufficient).toEqual({ _tag: "Insufficient" });

    const busy = setup();
    const release = holdWallet(busy.ops);
    const dropped = await busy.commands.payContact(alicePayment());
    await release();
    expect(dropped).toEqual({ _tag: "Busy" });

    for (const outcome of [insufficient, dropped])
      expect(paymentResultOf(outcome).retryable).toBe(true);
  });

  it("refuses a contact without an npub or a valid id", async () => {
    const { commands } = setup();
    expect(
      await commands.payContact(
        alicePayment({ contact: { id: CONTACT_ID, npub: "" } }),
      ),
    ).toEqual({ _tag: "MissingContactNpub" });
    expect(
      await commands.payContact(
        alicePayment({ contact: { id: "", npub: contactNpub } }),
      ),
    ).toEqual({ _tag: "InvalidContact" });
  });
});

describe("payCashuPaymentRequestByPost", () => {
  const request: CashuPaymentRequestMessageInfo = {
    amount: 600,
    description: "coffee",
    encodedRequest: "creqA",
    mintUrls: [MINT_URL],
    requestId: "request-1",
    transportNprofile: null,
    transportPostUrl: "https://shop.example/pay",
    transportPubkeyHex: null,
    unit: "sat",
  };

  it("posts the token, forgets the transfer and records the payment", async () => {
    const post = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", post);
    const { commands, linkshu, logPaymentEvent } = setup();

    const outcome = await commands.payCashuPaymentRequestByPost(request);

    expect(outcome).toMatchObject({ _tag: "Paid", receipt: sendReceipt });
    expect(post).toHaveBeenCalledOnce();
    expect(linkshu.cashuTransferLifecycle.forget).toHaveBeenCalledWith(
      sendReceipt.operationId,
    );
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ paymentType: "request", phase: "complete" }),
    );
    vi.unstubAllGlobals();
  });

  it("takes the token back when the POST fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const { commands, linkshu } = setup();

    expect(await commands.payCashuPaymentRequestByPost(request)).toEqual({
      _tag: "Failed",
      detail: "Payment request POST 500",
      insufficient: false,
    });
    expect(linkshu.cashuTransferLifecycle.returnToWallet).toHaveBeenCalledWith(
      sendReceipt.operationId,
    );
    vi.unstubAllGlobals();
  });

  it("refuses requests without a usable https POST target", async () => {
    const { commands, linkshu } = setup();
    const pay = (transportPostUrl: string | null) =>
      commands.payCashuPaymentRequestByPost({ ...request, transportPostUrl });

    expect(await pay(null)).toEqual({ _tag: "NoPostTransport" });
    expect(await pay("not a url")).toEqual({ _tag: "InvalidUrl" });
    expect(await pay("http://shop.example/pay")).toEqual({
      _tag: "InsecureTransport",
    });
    expect(linkshu.sendCashuToken).not.toHaveBeenCalled();
  });
});
