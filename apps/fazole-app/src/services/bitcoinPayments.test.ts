import {
  Bolt11Invoice,
  DecodedToken,
  encodeToken,
  Inspector,
  linkshuServices,
  MintUnreachable,
  MintUrl,
  OperationId,
  QuoteId,
  ReceiveReceipt,
  TokenAlreadyKnown,
  Topup,
  TopupQuote,
} from "@linky-fit/linkshu";
import {
  CashuTokenText,
  ChatMessageReceived,
  RumorId,
  TextBody,
  TokenBody,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect, Layer, ManagedRuntime, Result, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCashuRequest, CzkAmount, Sats } from "../domain";
import type { Ledger } from "../storage/ledger";
import { createBitcoinPayments } from "./bitcoinPayments";
import {
  fakeNostr,
  scriptedReceive,
  setup,
  testMint as mint,
} from "./testing/fakes";
import type { Wallet } from "./wallet";

/** A mint other than the shop's. */
const otherMint = "http://localhost:3340";

const tokenOf = (
  amount: number,
  tokenMint = mint,
  memo: string | null = null,
) =>
  encodeToken(
    Schema.decodeUnknownSync(DecodedToken)({
      mint: tokenMint,
      unit: "sat",
      memo,
      proofs: [
        {
          id: "00ad268c4d1f5826",
          amount,
          secret: `secret-${amount}`,
          C: "02".padEnd(66, "a"),
        },
      ],
    }),
  );

const receipt = (amount: number, operationId = "receive-1") =>
  Schema.decodeUnknownSync(ReceiveReceipt)({
    operationId,
    tokenText: tokenOf(amount),
    mint,
    unit: "sat",
    amount,
  });

const payer = makeIdentity().pubkey;

const chatMessage = (body: ChatMessageReceived["body"]) =>
  new ChatMessageReceived({
    messageId: RumorId.make("ab".repeat(32)),
    from: payer,
    body,
    replyTo: null,
    root: null,
    editOf: null,
    clientId: null,
    sentAt: UnixSeconds.make(1_700_000_000),
  });

/** A bare token as a NIP-17 chat token, which names no request. */
const tokenMessage = (amount: number, tokenMint = mint) =>
  chatMessage(
    new TokenBody({ token: CashuTokenText.make(tokenOf(amount, tokenMint)) }),
  );

/**
 * What Linky sends when its user pays a contact from the chat: the bare
 * token as a NIP-17 chat token, the user's note in the token memo.
 */
const directPayment = (amount: number, note: string) =>
  chatMessage(
    new TokenBody({
      token: CashuTokenText.make(tokenOf(amount, mint, note)),
    }),
  );

/** The NUT-18 payload a wallet sends for the request `id`. */
const nut18Payload = (id: string, amount = 100, payloadMint = mint) =>
  chatMessage(
    new TextBody({
      text: JSON.stringify({
        id,
        mint: payloadMint,
        unit: "sat",
        proofs: [{ id: "00ad268c4d1f5826", amount, secret: "s", C: "02" }],
      }),
    }),
  );

/** A pending 25 Kč payment whose Bitcoin leg asks `sats` at the local mint. */
const pendingBitcoinPayment = async (ledger: Ledger, sats = 100) => {
  const payment = await ledger.createPayment(CzkAmount.make(2_500));
  await ledger.attachBitcoinLeg(payment, {
    sats: Sats.make(sats),
    czkPerBtc: 2_500_000,
    mintUrl: mint,
    quoteId: `quote-${payment.id}`,
    invoice: "lnbc1fake",
    paymentRequest: buildCashuRequest({
      sats: Sats.make(sats),
      mintUrl: mint,
      deviceNprofile: "nprofile1test",
      paymentId: payment.id,
    }),
  });
  return payment.id;
};

const paymentsOf = (
  ledger: Ledger,
  wallet: Wallet,
  czkPerBtc: () => Promise<number | null>,
  mintUrl = mint,
) => {
  const fake = fakeNostr();
  const payments = createBitcoinPayments({
    ledger,
    nostr: fake.nostr,
    wallet,
    czkPerBtc,
    mintUrl: async () => mintUrl,
    shopName: async () => "Kavárna",
    whenHydrated: async () => {},
  });
  return { payments, fake };
};

const receiveId = OperationId.make("receive-1");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BitcoinPayments.request", () => {
  it("reports a missing rate and leaves the payment without a Bitcoin leg", async () => {
    const { ledger, wallet } = setup();
    const { id } = await ledger.createPayment(CzkAmount.make(2_500));
    const { payments } = paymentsOf(ledger, wallet, async () => null);
    expect(await payments.request(id)).toEqual({ reason: "rate-unavailable" });
    expect((await ledger.payment(id))?.bitcoin).toBeNull();
  });

  it("reports a mint it cannot reach", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ledger, wallet } = setup();
    const { id } = await ledger.createPayment(CzkAmount.make(2_500));
    const { payments } = paymentsOf(
      ledger,
      wallet,
      async () => 2_500_000,
      "http://127.0.0.1:9",
    );
    expect(await payments.request(id)).toEqual({ reason: "mint-unreachable" });
  });

  it("offers no Bitcoin below the amount the mint's fees allow", async () => {
    const { ledger, wallet } = setup();
    const { id } = await ledger.createPayment(CzkAmount.make(1));
    const { payments } = paymentsOf(
      ledger,
      wallet,
      async () => 2_500_000,
      "http://127.0.0.1:9",
    );
    expect(await payments.request(id)).toEqual({
      reason: "below-minimum",
      minimumCzk: 23,
    });
    expect((await ledger.payment(id))?.bitcoin).toBeNull();
  });

  it("leaves a payment a token paid while its quote was being created paid", async () => {
    const { account, ledger, wallet } = setup();
    const { id } = await ledger.createPayment(CzkAmount.make(2_500));
    const payWithToken = async () => {
      const pending = await ledger.payment(id);
      if (!pending) throw new Error("no payment");
      await ledger.completePayment(pending, {
        cashuReceive: { operationId: "receive-1", sats: 1_000 },
      });
    };
    const runtime = ManagedRuntime.make(
      Layer.merge(
        linkshuServices({ bip39Seed: account.cashuSeed }).pipe(
          Layer.provideMerge(Inspector.disabled),
        ),
        Layer.succeed(Topup, {
          start: (draft) =>
            Effect.promise(payWithToken).pipe(
              Effect.as({
                quote: new TopupQuote({
                  quoteId: QuoteId.make("quote-1"),
                  mint: draft.mint,
                  amount: draft.amount,
                  invoice: Bolt11Invoice.make("lnbc1fake"),
                  expiresAt: null,
                  locked: true,
                }),
                result: Effect.never,
              }),
            ),
          adopt: () => Effect.die("unused"),
          resumePending: () => Effect.succeed([]),
        }),
      ),
    );
    const { payments } = paymentsOf(
      ledger,
      { ...wallet, runtime },
      async () => 2_500_000,
    );
    expect(await payments.request(id)).toBeNull();
    expect(await ledger.payment(id)).toMatchObject({
      status: "paid",
      bitcoin: null,
      cashuReceive: { operationId: "receive-1" },
    });
    await runtime.dispose();
  });

  it("keeps the leg a payment already has", async () => {
    const { ledger, wallet } = setup();
    const id = await pendingBitcoinPayment(ledger);
    let rateAsked = false;
    const { payments } = paymentsOf(ledger, wallet, async () => {
      rateAsked = true;
      return 2_500_000;
    });
    expect(await payments.request(id)).toBeNull();
    expect(rateAsked).toBe(false);
    expect((await ledger.payment(id))?.bitcoin?.quoteId).toBe(`quote-${id}`);
  });
});

describe("tokens sent to the account", () => {
  const withHandler = async (
    answer: Parameters<typeof scriptedReceive>[1],
    overrides: Partial<Wallet> = {},
    czkPerBtc: number | null = 2_500_000,
  ) => {
    const { ledger, wallet } = setup();
    const scripted = scriptedReceive(wallet, answer, overrides);
    const { fake } = paymentsOf(ledger, scripted.wallet, async () => czkPerBtc);
    const [handler] = fake.inbox;
    if (!handler) throw new Error("no inbox handler");
    const id = await pendingBitcoinPayment(ledger);
    return { ledger, wallet, handler, calls: scripted.calls, id };
  };

  it("pays the payment a NUT-18 payload names once the sats it brought in cover the request, and remembers who sent it", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100)),
    );
    await handler(nut18Payload(id, 101), "live");
    expect(await ledger.payment(id)).toMatchObject({
      status: "paid",
      method: "cashu",
      cashuReceive: { operationId: "receive-1", sats: 100 },
      payerPubkey: payer,
    });
    expect((await ledger.records()).receipts).toEqual([]);
  });

  it("keeps a payload whose sats, net of the mint's fee, fall short of its request as a direct transfer", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(99)),
    );
    await handler(nut18Payload(id), "live");
    expect((await ledger.payment(id))?.status).toBe("pending");
    expect((await ledger.records()).directTransfers).toMatchObject([
      { sats: 99, payerPubkey: payer },
    ]);
  });

  it("keeps a payload from another mint than its request's as a direct transfer at that mint", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100)),
    );
    await handler(nut18Payload(id, 100, otherMint), "live");
    expect((await ledger.payment(id))?.status).toBe("pending");
    expect((await ledger.records()).directTransfers).toMatchObject([
      { sats: 100, mintUrl: otherMint },
    ]);
  });

  it("keeps a bare token of the requested amount as a direct transfer", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100)),
    );
    await handler(tokenMessage(100), "live");
    expect((await ledger.payment(id))?.status).toBe("pending");
    expect((await ledger.records()).directTransfers).toMatchObject([
      { sats: 100, payerPubkey: payer },
    ]);
  });

  it("pays a payment the merchant cancelled when its payload arrives late", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100)),
    );
    const cancelled = await ledger.payment(id);
    if (!cancelled) throw new Error("no payment");
    await ledger.cancelPayment(cancelled);
    await handler(nut18Payload(id), "live");
    expect(await ledger.payment(id)).toMatchObject({
      status: "paid",
      method: "cashu",
      paidAtSec: expect.any(Number),
    });
  });

  it("records a payment Linky sends from the chat as a direct transfer from its sender, with their note and its CZK rate", async () => {
    const { ledger, handler, calls, id } = await withHandler(() =>
      Result.succeed(receipt(299)),
    );
    await handler(directPayment(300, "Za kávu\na dort"), "live");
    expect(calls).toEqual([tokenOf(300, mint, "Za kávu\na dort")]);
    const { payments, receipts, directTransfers } = await ledger.records();
    expect(payments.find((payment) => payment.id === id)?.status).toBe(
      "pending",
    );
    expect(receipts).toEqual([]);
    expect(directTransfers).toEqual([
      {
        id: expect.any(String),
        sats: 299,
        czkPerBtc: 2_500_000,
        receivedAtSec: expect.any(Number),
        operationId: "receive-1",
        mintUrl: mint,
        payerPubkey: payer,
        note: "Za kávu a dort",
        hiddenAtSec: null,
      },
    ]);
  });

  it("records a direct transfer once when the inbox replays it", async () => {
    const { ledger, handler } = await withHandler(
      () => Result.fail(new TokenAlreadyKnown({ operationId: receiveId })),
      { isReceived: async (operationId) => operationId === "receive-1" },
    );
    await handler(directPayment(300, "Za kávu"), "backfill");
    await handler(directPayment(300, "Za kávu"), "backfill");
    expect((await ledger.records()).directTransfers).toMatchObject([
      { operationId: "receive-1", sats: 300, note: "Za kávu" },
    ]);
  });

  it("keeps a direct transfer in sats while the rate is unavailable", async () => {
    const { ledger, handler } = await withHandler(
      () => Result.succeed(receipt(300)),
      {},
      null,
    );
    await handler(directPayment(300, "Za kávu"), "live");
    expect((await ledger.records()).directTransfers).toMatchObject([
      { sats: 300, czkPerBtc: null },
    ]);
  });

  it("records a payload for a paid payment as paying it again", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100, "receive-2")),
    );
    const paid = await ledger.payment(id);
    if (!paid) throw new Error("no payment");
    await ledger.completePayment(paid, "lightning");
    await handler(nut18Payload(id), "live");
    expect((await ledger.records()).receipts).toMatchObject([
      { method: "cashu", sats: 100, paymentId: id },
    ]);
  });

  it("matches a NUT-18 payload in a text message by its request id, also after its quote expired", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100)),
    );
    const payment = await ledger.payment(id);
    if (!payment) throw new Error("no payment");
    await ledger.clearLightningQuote(payment);
    await handler(nut18Payload(id), "backfill");
    expect(await ledger.payment(id)).toMatchObject({
      status: "paid",
      cashuReceive: { operationId: "receive-1" },
    });
  });

  it("pays the payment a replayed payload was received for before a reload", async () => {
    const { ledger, handler, id } = await withHandler(
      () => Result.fail(new TokenAlreadyKnown({ operationId: receiveId })),
      { isReceived: async (operationId) => operationId === "receive-1" },
    );
    await handler(nut18Payload(id), "backfill");
    expect(await ledger.payment(id)).toMatchObject({
      status: "paid",
      method: "cashu",
      cashuReceive: { operationId: "receive-1", sats: 100 },
    });
  });

  it("never pays a second payment with a replayed payload", async () => {
    const { ledger, handler, id } = await withHandler(
      () => Result.fail(new TokenAlreadyKnown({ operationId: receiveId })),
      { isReceived: async () => true },
    );
    const earlier = await ledger.payment(
      await pendingBitcoinPayment(ledger, 120),
    );
    if (!earlier) throw new Error("no payment");
    await ledger.completePayment(earlier, {
      cashuReceive: { operationId: "receive-1", sats: 120 },
    });
    await handler(nut18Payload(id), "backfill");
    expect((await ledger.payment(id))?.status).toBe("pending");
  });

  it("never pays a payment with a token the wallet did not receive", async () => {
    const { ledger, handler, id } = await withHandler(
      () => Result.fail(new TokenAlreadyKnown({ operationId: receiveId })),
      { isReceived: async () => false },
    );
    await handler(nut18Payload(id), "backfill");
    expect((await ledger.payment(id))?.status).toBe("pending");
  });

  it("leaves a token for the next session while its mint is unreachable", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.fail(
        new MintUnreachable({ mint: MintUrl.make(mint), detail: null }),
      ),
    );
    await expect(handler(nut18Payload(id), "live")).rejects.toMatchObject({
      _tag: "MintUnreachable",
    });
    expect((await ledger.payment(id))?.status).toBe("pending");
  });

  it("ignores chat text that carries no token", async () => {
    const { handler, calls } = await withHandler(() =>
      Result.succeed(receipt(100)),
    );
    await handler(chatMessage(new TextBody({ text: "díky!" })), "live");
    expect(calls).toEqual([]);
  });
});
