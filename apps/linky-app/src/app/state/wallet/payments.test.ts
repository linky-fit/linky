import { createIdFromString } from "@linky-fit/linksync";
import {
  Amount,
  AutoswapEstimate,
  AutoswapReceipt,
  CurrencyUnit,
  LockingUnsupported,
  InsufficientFunds,
  MeltReceipt,
  MintInfo,
  MintRejected,
  MintUnreachable,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  parseP2pkPubkey,
  PaymentPending,
  Proof,
  QuoteId,
  ReceiveReceipt,
  SendReceipt,
  TokenText,
} from "@linky-fit/linkshu";
import { PaymentRequestId } from "@linky-fit/linkshu/payment-request";
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
import { Exit, Result, Schema } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import type { LnurlPayInvoiceResult } from "../../../lnurlPay";
import { buildCashuToken } from "../../../testUtils/cashuToken";
import { makeLightningInvoice } from "../../../testUtils/lightningInvoice";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { walletBalancesOf } from "../../../testUtils/walletFakes";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import { NO_WRITE } from "../../lib/storeWrite";
import type { CashuTransferLifecycle } from "../linkshu/commands";
import { makeWalletOps } from "./opQueue";
import {
  makePaymentsCommands,
  type ContactPayment,
  type PaymentRequestQuote,
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
const TARGET = "https://target.example";
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

const unreachable = (mint = MINT_URL) =>
  new MintUnreachable({ mint: MintUrl.make(mint), detail: "fetch failed" });

const rejected = (mint = MINT_URL) =>
  new MintRejected({ mint: MintUrl.make(mint), code: null, detail: "down" });

/** The device drops offline while `step` runs, which then fails. */
const goingOffline = () => {
  let connected = true;
  return {
    isOnline: () => connected,
    drop: () => {
      connected = false;
    },
  };
};

const insufficientFunds = (required: number, available: number) =>
  new InsufficientFunds({
    mint: MintUrl.make(MINT_URL),
    required: Amount.make(required),
    available: NonNegativeAmount.make(available),
  });

const proof = Schema.decodeUnknownSync(Proof)({
  id: "00ad268c4d1f5826",
  amount: 600,
  secret: "proof-secret",
  C: `02${"ab".repeat(32)}`,
});

const sendReceipt = new SendReceipt({
  operationId: OperationId.make("send-op"),
  tokenText: TokenText.make(
    buildCashuToken({ amounts: [600], mint: MINT_URL, unit: "sat" }),
  ),
  proofs: [proof],
  mint: MintUrl.make(MINT_URL),
  unit: CurrencyUnit.make("sat"),
  amount: Amount.make(600),
  lockTo: null,
  changeAmount: NonNegativeAmount.make(400),
  feePaid: NonNegativeAmount.make(0),
});

const mintInfo = (overrides: Partial<MintInfo> = {}) =>
  new MintInfo({
    url: MintUrl.make(TARGET),
    name: null,
    inputFeePpk: 100,
    supportsMpp: false,
    supportsP2pk: true,
    isFakeLightning: false,
    iconUrl: null,
    ...overrides,
  });

const autoswapEstimate = (
  move: { sourceMint: string; targetMint: string; amountSat?: number },
  fees: number,
) =>
  new AutoswapEstimate({
    sourceMint: MintUrl.make(move.sourceMint),
    targetMint: MintUrl.make(move.targetMint),
    amount: Amount.make(move.amountSat ?? 1),
    lightningFeeReserve: NonNegativeAmount.make(fees),
    inputFee: NonNegativeAmount.make(0),
    totalFromSource: Amount.make((move.amountSat ?? 1) + fees),
  });

const autoswapReceipt = (move: {
  sourceMint: string;
  targetMint: string;
  amountSat?: number;
}) =>
  new AutoswapReceipt({
    sourceMint: MintUrl.make(move.sourceMint),
    targetMint: MintUrl.make(move.targetMint),
    movedAmount: Amount.make(move.amountSat ?? 1),
    feePaid: NonNegativeAmount.make(4),
    operationId: OperationId.make("move-op"),
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
  ...overrides,
});

const setup = ({
  balances = { [MINT_URL]: 1_000 },
  chat = chatWrites(),
  online = true,
  isOnline = () => online,
  lifecycle = transferLifecycle(),
  ...overrides
}: {
  balances?: Record<string, number>;
  chat?: PaymentsDeps["chat"];
  online?: boolean;
  isOnline?: () => boolean;
  lifecycle?: CashuTransferLifecycle;
} & Partial<
  Pick<
    PaymentsDeps["linkshu"],
    | "autoswapCashu"
    | "estimateAutoswapCashu"
    | "fetchMintInfo"
    | "meltCashuInvoice"
    | "sendCashuToken"
  >
> = {}) => {
  const ops = makeWalletOps(() => {});
  const linkshu = {
    autoswapCashu: vi.fn<PaymentsDeps["linkshu"]["autoswapCashu"]>(
      overrides.autoswapCashu ??
        (async (move) => Result.succeed(autoswapReceipt(move))),
    ),
    cashuTransferLifecycle: lifecycle,
    estimateAutoswapCashu: vi.fn<
      PaymentsDeps["linkshu"]["estimateAutoswapCashu"]
    >(
      overrides.estimateAutoswapCashu ??
        (async (move) => Result.succeed(autoswapEstimate(move, 10))),
    ),
    fetchMintInfo: vi.fn<PaymentsDeps["linkshu"]["fetchMintInfo"]>(
      overrides.fetchMintInfo ?? (async () => Result.succeed(mintInfo())),
    ),
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
    isOnline,
    linkshu,
    linkstr,
    logPaymentEvent,
    mintFeePpk: () => 100,
    ops,
    userMints: () => [MINT_URL, FOREIGN],
  });
  return { commands, linkshu, linkstr, logPaymentEvent, ops };
};

const alicePayment = (
  overrides: Partial<ContactPayment> = {},
): ContactPayment => ({
  amountSat: 600,
  contact: { id: CONTACT_ID, name: "Alice", npub: contactNpub },
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

  it("is insufficient when no move covers it", async () => {
    const { commands } = setup({ balances: { [MINT_URL]: 50, [FOREIGN]: 80 } });
    expect(await commands.fundsFor(200)).toEqual({ _tag: "Insufficient" });
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

  it("fails offline before melting, and on a mint it cannot reach", async () => {
    const offline = setup({ online: false });
    expect(await offline.commands.payLightningInvoice("lnbc-mock")).toEqual({
      _tag: "NetworkError",
    });
    expect(offline.linkshu.meltCashuInvoice).not.toHaveBeenCalled();

    const { commands, logPaymentEvent } = setup({
      meltCashuInvoice: async () => Result.fail(unreachable()),
    });
    expect(await commands.payLightningInvoice("lnbc-mock")).toEqual({
      _tag: "NetworkError",
    });
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "melt", status: "error" }),
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

  it("fails offline before fetching an invoice", async () => {
    const { commands } = setup({ online: false });

    expect(
      await commands.payLightningAddress({
        lnAddress: "alice@example.com",
        amountSat: 40,
        contact: null,
      }),
    ).toEqual({ _tag: "NetworkError" });
    expect(fetchLnurlInvoiceForTarget).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the invoice fetch",
      () => {
        const network = goingOffline();
        fetchLnurlInvoiceForTarget.mockImplementation(async () => {
          network.drop();
          throw new TypeError("Failed to fetch");
        });
        return setup({ isOnline: network.isOnline });
      },
    ],
    [
      "the melt",
      () => {
        fetchLnurlInvoiceForTarget.mockResolvedValue(invoiceFor(40));
        return setup({
          meltCashuInvoice: async () => Result.fail(unreachable()),
        });
      },
    ],
  ])(
    "reports a network error from %s without trying a lower amount",
    async (_step, start) => {
      const { commands } = start();

      expect(
        await commands.payLightningAddress({
          lnAddress: "alice@example.com",
          amountSat: 40,
          contact: null,
        }),
      ).toEqual({ _tag: "NetworkError" });
      expect(fetchLnurlInvoiceForTarget).toHaveBeenCalledOnce();
    },
  );

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

  it("types a send for a bank offer as proxy", async () => {
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

  it("fails offline before any token is made", async () => {
    const chat = chatWrites();
    const { commands, linkshu } = setup({ chat, online: false });

    expect(await commands.payContact(alicePayment())).toEqual({
      _tag: "NetworkError",
    });
    expect(linkshu.sendCashuToken).not.toHaveBeenCalled();
    expect(chat.appendLocalNostrMessage).not.toHaveBeenCalled();
  });

  it("reports a network error when the mint is unreachable or the device drops offline mid-send", async () => {
    const unreachableMint = setup({
      sendCashuToken: async () => Result.fail(unreachable()),
    });
    expect(await unreachableMint.commands.payContact(alicePayment())).toEqual({
      _tag: "NetworkError",
    });

    const network = goingOffline();
    const droppedOffline = setup({
      isOnline: network.isOnline,
      sendCashuToken: async () => {
        network.drop();
        return Result.fail(rejected());
      },
    });
    expect(await droppedOffline.commands.payContact(alicePayment())).toEqual({
      _tag: "NetworkError",
    });
    expect(droppedOffline.linkstr.enqueueOutbox).not.toHaveBeenCalled();
  });

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
    expect(linkstr.enqueueOutbox).not.toHaveBeenCalled();
  });

  it("refuses a payment no mint covers, and one while the wallet is busy", async () => {
    const short = setup({ balances: { [MINT_URL]: 100 } });
    expect(await short.commands.payContact(alicePayment())).toEqual({
      _tag: "Insufficient",
    });

    const busy = setup();
    const release = holdWallet(busy.ops);
    const dropped = await busy.commands.payContact(alicePayment());
    await release();
    expect(dropped).toEqual({ _tag: "Busy" });
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

describe("payment requests", () => {
  const requestId = PaymentRequestId.make("request-1");
  const payeeRelay = RelayUrl.make("wss://payee.example");
  const alice = { id: CONTACT_ID, name: "Alice", npub: contactNpub };
  const request = (
    overrides: Partial<CashuPaymentRequestMessageInfo> = {},
  ): CashuPaymentRequestMessageInfo => ({
    amount: 600,
    description: "coffee",
    encodedRequest: "creqA",
    lockTo: null,
    mintUrls: [MINT_URL],
    mintsAdvisory: false,
    outsideMintFee: 0,
    preferredTransport: "nostr",
    requestId,
    transportNprofile: "nprofile",
    transportPostUrl: null,
    transportPubkeyHex: contactPubkey,
    transportRelays: [payeeRelay],
    unit: "sat",
    ...overrides,
  });
  const direct = {
    _tag: "Direct",
    amount: 600,
    fee: 1,
    mint: MintUrl.make(MINT_URL),
    methodFee: 0,
  } satisfies PaymentRequestQuote;
  const overLightning = {
    _tag: "Lightning",
    amount: 600,
    fee: 10,
    sourceMint: MintUrl.make(FOREIGN),
    targetMint: TARGET,
    addsMint: true,
    moveAmount: 602,
  } satisfies PaymentRequestQuote;
  const postRequest = request({
    transportPubkeyHex: null,
    transportNprofile: null,
    transportPostUrl: "https://shop.example/pay",
    transportRelays: [],
  });

  describe("quotePaymentRequest", () => {
    it("adds the request's melt fee when paying from outside its mint list", async () => {
      const { commands, linkshu } = setup();
      const advisory = request({
        mintUrls: [TARGET],
        mintsAdvisory: true,
        outsideMintFee: 3,
      });
      const quote = await commands.quotePaymentRequest(advisory, 600);
      expect(quote).toEqual({
        _tag: "Direct",
        amount: 600,
        fee: 7,
        mint: MINT_URL,
        methodFee: 3,
      });
      assert(quote._tag === "Direct");
      await commands.payPaymentRequest({
        request: advisory,
        quote,
        recipient: alice,
      });
      expect(linkshu.sendCashuToken).toHaveBeenCalledWith(
        expect.objectContaining({ amountSat: 603, includeRecipientFee: true }),
      );
    });

    it("prices a direct payment with the mint's send fee allowance", async () => {
      const { commands } = setup();
      expect(await commands.quotePaymentRequest(request(), 600)).toEqual({
        _tag: "Direct",
        amount: 600,
        // 600 is 10 bits, plus the fee's own proof, at 100 ppk, for both swaps.
        fee: 4,
        mint: MINT_URL,
        methodFee: 0,
      });
    });

    it("moves over Lightning from the smallest balance that covers the move", async () => {
      const { commands, linkshu } = setup({
        balances: { [MINT_URL]: 1_000, [FOREIGN]: 650 },
        estimateAutoswapCashu: async (move) =>
          Result.succeed(
            autoswapEstimate(move, move.sourceMint === FOREIGN ? 60 : 10),
          ),
      });

      expect(
        await commands.quotePaymentRequest(
          request({ mintUrls: [TARGET] }),
          600,
        ),
      ).toEqual({
        _tag: "Lightning",
        amount: 600,
        fee: 14,
        sourceMint: MINT_URL,
        targetMint: TARGET,
        addsMint: true,
        moveAmount: 604,
      });
      expect(
        linkshu.estimateAutoswapCashu.mock.calls.map(([move]) => move),
      ).toEqual([
        { sourceMint: FOREIGN, targetMint: TARGET, amountSat: 604 },
        { sourceMint: MINT_URL, targetMint: TARGET, amountSat: 604 },
      ]);
    });

    it("refuses a locked request when the Lightning target lacks NUT-11", async () => {
      const { commands, linkshu } = setup({
        fetchMintInfo: async () =>
          Result.succeed(mintInfo({ supportsP2pk: false })),
      });

      expect(
        await commands.quotePaymentRequest(
          request({ mintUrls: [TARGET], lockTo: parseP2pkPubkey(contactNpub) }),
          600,
        ),
      ).toEqual({ _tag: "LockingUnsupported" });
      expect(linkshu.estimateAutoswapCashu).not.toHaveBeenCalled();
    });

    it("fails offline, and when the Lightning target cannot be reached", async () => {
      const offline = setup({ online: false });
      expect(
        await offline.commands.quotePaymentRequest(request(), 600),
      ).toEqual({ _tag: "NetworkError" });

      const { commands } = setup({
        fetchMintInfo: async () => Result.fail(unreachable(TARGET)),
      });
      expect(
        await commands.quotePaymentRequest(
          request({ mintUrls: [TARGET] }),
          600,
        ),
      ).toEqual({ _tag: "NetworkError" });
    });

    it("passes on the mint move a short default mint needs, and an unreachable target", async () => {
      const short = setup({ balances: { [MINT_URL]: 50, [FOREIGN]: 80 } });
      expect(
        await short.commands.quotePaymentRequest(
          request({ mintUrls: [] }),
          100,
        ),
      ).toEqual({ _tag: "NeedsMintMove", fromMint: FOREIGN, toMint: MINT_URL });

      const unreachable = setup({
        estimateAutoswapCashu: async () =>
          Result.fail(
            new MintRejected({
              mint: MintUrl.make(TARGET),
              code: null,
              detail: "down",
            }),
          ),
      });
      expect(
        await unreachable.commands.quotePaymentRequest(
          request({ mintUrls: [TARGET] }),
          600,
        ),
      ).toEqual({ _tag: "Failed", detail: "Mint rejected the token: down" });
    });
  });

  describe("payPaymentRequest", () => {
    it("sends the NUT-18 payload to the request's key and relays as a reply", async () => {
      const { commands, linkshu, linkstr, logPaymentEvent } = setup();
      const replyToId = "ab".repeat(32);

      const outcome = await commands.payPaymentRequest({
        request: request(),
        quote: direct,
        recipient: alice,
        replyContext: {
          replyToId,
          rootMessageId: replyToId,
          replyToContent: "creqA",
        },
      });

      expect(outcome).toEqual({
        _tag: "Paid",
        receipt: sendReceipt,
        contactId: CONTACT_ID,
        queued: false,
      });
      expect(linkshu.sendCashuToken).toHaveBeenCalledWith({
        amountSat: 600,
        memo: "coffee",
        mint: MINT_URL,
        produceAs: "pending",
        lockTo: null,
        includeRecipientFee: true,
      });
      const [input] = linkstr.enqueueOutbox.mock.calls[0];
      assert(input.op._tag === "chat.token");
      const { draft } = input.op;
      expect(draft.to).toBe(contactPubkey);
      expect(draft.recipientRelays).toEqual([payeeRelay]);
      expect(draft.replyTo).toBe(replyToId);
      expect(JSON.parse(draft.token)).toEqual({
        id: "request-1",
        memo: "coffee",
        mint: MINT_URL,
        unit: "sat",
        proofs: [
          {
            id: proof.id,
            amount: 600,
            secret: proof.secret,
            C: proof.C,
          },
        ],
      });
      expect(linkshu.cashuTransferLifecycle.forget).toHaveBeenCalledWith(
        sendReceipt.operationId,
      );
      expect(linkstr.sendPaymentNotice).toHaveBeenCalledOnce();
      expect(logPaymentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          contactId: CONTACT_ID,
          details: { issuedToken: sendReceipt.tokenText, requestId },
          paymentType: "request",
          phase: "complete",
          status: "ok",
        }),
      );
    });

    it("moves over Lightning, then sends at the target mint", async () => {
      const operations: string[] = [];
      const { commands, logPaymentEvent } = setup({
        autoswapCashu: async (move) => {
          operations.push(
            `move:${move.sourceMint}>${move.targetMint}:${move.amountSat}`,
          );
          return Result.succeed(autoswapReceipt(move));
        },
        sendCashuToken: async (args) => {
          operations.push(`send:${args.mint}:${args.amountSat}`);
          return Result.succeed(sendReceipt);
        },
      });

      expect(
        await commands.payPaymentRequest({
          request: request({ mintUrls: [TARGET] }),
          quote: overLightning,
          recipient: alice,
        }),
      ).toMatchObject({ _tag: "Paid" });
      expect(operations).toEqual([
        `move:${FOREIGN}>${TARGET}:602`,
        `send:${TARGET}:600`,
      ]);
      expect(logPaymentEvent).toHaveBeenCalledWith(
        expect.objectContaining({ fee: 4, status: "ok" }),
      );
    });

    it("leaves the moved sats at the target when the send after the move fails", async () => {
      const { commands, linkstr } = setup({
        sendCashuToken: async () => Result.fail(insufficientFunds(600, 10)),
      });

      expect(
        await commands.payPaymentRequest({
          request: request({ mintUrls: [TARGET] }),
          quote: overLightning,
          recipient: alice,
        }),
      ).toEqual({
        _tag: "Failed",
        detail: "Insufficient funds (need 600, have 10)",
        insufficient: true,
        movedTo: TARGET,
      });
      expect(linkstr.enqueueOutbox).not.toHaveBeenCalled();
    });

    it("fails offline before anything moves", async () => {
      const { commands, linkshu } = setup({ online: false });

      expect(
        await commands.payPaymentRequest({
          request: request({ mintUrls: [TARGET] }),
          quote: overLightning,
          recipient: alice,
        }),
      ).toEqual({ _tag: "NetworkError" });
      expect(linkshu.autoswapCashu).not.toHaveBeenCalled();
      expect(linkshu.sendCashuToken).not.toHaveBeenCalled();
    });

    it("reports a network error when the move or the send cannot reach the mint", async () => {
      const move = setup({
        autoswapCashu: async () => Result.fail(unreachable(FOREIGN)),
      });
      expect(
        await move.commands.payPaymentRequest({
          request: request({ mintUrls: [TARGET] }),
          quote: overLightning,
          recipient: alice,
        }),
      ).toEqual({ _tag: "NetworkError" });
      expect(move.linkshu.sendCashuToken).not.toHaveBeenCalled();

      const send = setup({
        sendCashuToken: async () => Result.fail(unreachable()),
      });
      expect(
        await send.commands.payPaymentRequest({
          request: request(),
          quote: direct,
          recipient: alice,
        }),
      ).toEqual({ _tag: "NetworkError" });
    });

    it("says where the moved sats are when the send after the move cannot reach the mint", async () => {
      const { commands } = setup({
        sendCashuToken: async () => Result.fail(unreachable(TARGET)),
      });

      expect(
        await commands.payPaymentRequest({
          request: request({ mintUrls: [TARGET] }),
          quote: overLightning,
          recipient: alice,
        }),
      ).toMatchObject({ _tag: "Failed", movedTo: TARGET });
    });

    it("sends nothing when the Lightning move fails", async () => {
      const { commands, linkshu } = setup({
        autoswapCashu: async () => Result.fail(insufficientFunds(612, 600)),
      });

      expect(
        await commands.payPaymentRequest({
          request: request({ mintUrls: [TARGET] }),
          quote: overLightning,
          recipient: alice,
        }),
      ).toMatchObject({ _tag: "Failed", movedTo: null });
      expect(linkshu.sendCashuToken).not.toHaveBeenCalled();
    });

    it("locks the proofs to the request's key and reports a mint without NUT-11", async () => {
      const lockTo = parseP2pkPubkey(contactNpub);
      const { commands, linkshu } = setup({
        sendCashuToken: async () =>
          Result.fail(new LockingUnsupported({ mint: MintUrl.make(MINT_URL) })),
      });

      expect(
        await commands.payPaymentRequest({
          request: request({ lockTo }),
          quote: direct,
          recipient: alice,
        }),
      ).toEqual({ _tag: "LockingUnsupported" });
      expect(linkshu.sendCashuToken).toHaveBeenCalledWith(
        expect.objectContaining({ lockTo }),
      );
    });

    it("posts the payload to a request without a nostr transport", async () => {
      const post = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 200 }),
      );
      vi.stubGlobal("fetch", post);
      const { commands, linkshu, logPaymentEvent } = setup();

      expect(
        await commands.payPaymentRequest({
          request: postRequest,
          quote: direct,
          recipient: null,
        }),
      ).toEqual({
        _tag: "Paid",
        receipt: sendReceipt,
        contactId: null,
        queued: false,
      });
      const [url, init] = post.mock.calls[0];
      expect(url).toBe("https://shop.example/pay");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        id: "request-1",
        mint: MINT_URL,
      });
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

      expect(
        await commands.payPaymentRequest({
          request: postRequest,
          quote: direct,
          recipient: null,
        }),
      ).toEqual({
        _tag: "Failed",
        detail: "Payment request POST 500",
        insufficient: false,
        movedTo: null,
      });
      expect(
        linkshu.cashuTransferLifecycle.returnToWallet,
      ).toHaveBeenCalledWith(sendReceipt.operationId);
      vi.unstubAllGlobals();
    });

    it("reports a network error when the POST cannot reach its target", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      );
      const { commands, linkshu } = setup();

      expect(
        await commands.payPaymentRequest({
          request: postRequest,
          quote: direct,
          recipient: null,
        }),
      ).toEqual({ _tag: "NetworkError" });
      expect(
        linkshu.cashuTransferLifecycle.returnToWallet,
      ).toHaveBeenCalledWith(sendReceipt.operationId);
      vi.unstubAllGlobals();
    });

    it("refuses a request without a usable transport before any send", async () => {
      const { commands, linkshu } = setup();
      const pay = (transportPostUrl: string | null) =>
        commands.payPaymentRequest({
          request: { ...postRequest, transportPostUrl },
          quote: direct,
          recipient: null,
        });

      expect(await pay(null)).toEqual({ _tag: "NoTransport" });
      expect(await pay("http://shop.example/pay")).toEqual({
        _tag: "InsecureTransport",
      });
      expect(linkshu.sendCashuToken).not.toHaveBeenCalled();
    });

    it("says where the moved sats are when the chat request changed after a Lightning move", async () => {
      let approved = true;
      const { commands, linkshu } = setup({
        autoswapCashu: async (move) => {
          approved = false;
          return Result.succeed(autoswapReceipt(move));
        },
      });

      expect(
        await commands.payPaymentRequest({
          request: request({ mintUrls: [TARGET] }),
          quote: overLightning,
          recipient: alice,
          isPaymentAuthorized: () => approved,
        }),
      ).toMatchObject({ _tag: "Failed", movedTo: TARGET });
      expect(
        linkshu.cashuTransferLifecycle.returnToWallet,
      ).toHaveBeenCalledWith(sendReceipt.operationId);
    });

    it("returns the token when the chat request changed during the send", async () => {
      let approved = true;
      const { commands, linkshu, linkstr } = setup({
        sendCashuToken: async () => {
          approved = false;
          return Result.succeed(sendReceipt);
        },
      });

      expect(
        await commands.payPaymentRequest({
          request: request(),
          quote: direct,
          recipient: alice,
          isPaymentAuthorized: () => approved,
        }),
      ).toEqual({ _tag: "AuthorizationChanged" });
      expect(
        linkshu.cashuTransferLifecycle.returnToWallet,
      ).toHaveBeenCalledWith(sendReceipt.operationId);
      expect(linkstr.enqueueOutbox).not.toHaveBeenCalled();
    });
  });
});
