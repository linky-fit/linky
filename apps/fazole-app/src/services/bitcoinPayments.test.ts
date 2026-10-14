import {
  DecodedToken,
  encodeToken,
  MintUnreachable,
  MintUrl,
  OperationId,
  ReceiveReceipt,
  TokenAlreadyKnown,
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
import { Result, Schema } from "effect";
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

const tokenOf = (amount: number) =>
  encodeToken(
    Schema.decodeUnknownSync(DecodedToken)({
      mint,
      unit: "sat",
      memo: null,
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

const tokenMessage = (amount: number) =>
  chatMessage(new TokenBody({ token: CashuTokenText.make(tokenOf(amount)) }));

/** The NUT-18 payload a non-Linky wallet sends for the request `id`. */
const nut18Payload = (id: string) =>
  chatMessage(
    new TextBody({
      text: JSON.stringify({
        id,
        mint,
        unit: "sat",
        proofs: [{ id: "00ad268c4d1f5826", amount: 100, secret: "s", C: "02" }],
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
    mintUrl,
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
  ) => {
    const { ledger, wallet } = setup();
    const scripted = scriptedReceive(wallet, answer, overrides);
    const { fake } = paymentsOf(ledger, scripted.wallet, async () => 2_500_000);
    const [handler] = fake.inbox;
    if (!handler) throw new Error("no inbox handler");
    const id = await pendingBitcoinPayment(ledger);
    return { ledger, wallet, handler, calls: scripted.calls, id };
  };

  it("pays the matching payment with Cashu once the token is received, net of the mint's fee, and remembers who sent it", async () => {
    const { ledger, handler, calls, id } = await withHandler(() =>
      Result.succeed(receipt(99)),
    );
    await handler(tokenMessage(100), "live");
    expect(calls).toEqual([tokenOf(100)]);
    expect(await ledger.payment(id)).toMatchObject({
      status: "paid",
      method: "cashu",
      cashuReceive: { operationId: "receive-1", sats: 99 },
      payerPubkey: payer,
    });
    expect((await ledger.records()).receipts).toEqual([]);
  });

  it("pays a payment the merchant cancelled when its token arrives late", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100)),
    );
    const cancelled = await ledger.payment(id);
    if (!cancelled) throw new Error("no payment");
    await ledger.cancelPayment(cancelled);
    await handler(tokenMessage(100), "live");
    expect(await ledger.payment(id)).toMatchObject({
      status: "paid",
      method: "cashu",
      paidAtSec: expect.any(Number),
    });
  });

  it("keeps a token two requests could be paid by as an unassigned receipt", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100)),
    );
    const twin = await pendingBitcoinPayment(ledger);
    await handler(tokenMessage(100), "live");
    expect((await ledger.payment(id))?.status).toBe("pending");
    expect((await ledger.payment(twin))?.status).toBe("pending");
    expect((await ledger.records()).receipts).toMatchObject([
      { method: "cashu", sats: 100, paymentId: null },
    ]);
  });

  it("records a token for a paid payment as paying it again", async () => {
    const { ledger, handler, id } = await withHandler(() =>
      Result.succeed(receipt(100, "receive-2")),
    );
    const paid = await ledger.payment(id);
    if (!paid) throw new Error("no payment");
    await ledger.completePayment(paid, "lightning");
    await handler(tokenMessage(100), "live");
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

  it("pays the payment a replayed token was received for before a reload", async () => {
    const { ledger, handler, id } = await withHandler(
      () => Result.fail(new TokenAlreadyKnown({ operationId: receiveId })),
      { isReceived: async (operationId) => operationId === "receive-1" },
    );
    await handler(tokenMessage(100), "backfill");
    expect(await ledger.payment(id)).toMatchObject({
      status: "paid",
      method: "cashu",
      cashuReceive: { operationId: "receive-1", sats: 100 },
    });
  });

  it("never pays a second payment with a replayed token", async () => {
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
    await handler(tokenMessage(100), "backfill");
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
    await expect(handler(tokenMessage(100), "live")).rejects.toMatchObject({
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
