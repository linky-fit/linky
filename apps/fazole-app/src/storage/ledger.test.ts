import { MintUrl, QuoteId } from "@linky-fit/linkshu";
import {
  createId,
  NonEmptyString100,
  NonEmptyString,
  PositiveInt,
  transactionIdForQuote,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { CzkAmount, Sats } from "../domain";
import { setup, testMint } from "../services/testing/fakes";

const leg = {
  sats: Sats.make(1_000),
  czkPerBtc: 2_500_000,
  mintUrl: testMint,
  paymentRequest: "creqAtest",
  quoteId: "quote-1",
  invoice: "lnbc1test",
};

describe("payments", () => {
  it("are Linky transaction rows with the fazole fields in their details", async () => {
    const { ledger, repositories } = setup();
    const created = await ledger.createPayment(CzkAmount.make(25_000));
    expect(created).toMatchObject({ status: "pending", method: null });
    expect(created.vs).toMatch(/^[1-9]\d{9}$/u);
    await ledger.attachBitcoinLeg(created, leg);
    const withLeg = await ledger.payment(created.id);
    if (!withLeg) throw new Error("no payment");
    expect(await ledger.completePayment(withLeg, "lightning")).toBe(true);

    const [row] = await Effect.runPromise(repositories.transactions.all);
    expect(row).toMatchObject({
      id: created.id,
      direction: "in",
      status: "ok",
      method: "lightning",
      amount: 1_000,
      mint: testMint,
      unit: "sat",
    });
    expect(JSON.parse(row?.detailsJson ?? "")).toMatchObject({
      app: "fazole",
      kind: "payment",
      amountCzk: 25_000,
      vs: created.vs,
      bitcoin: leg,
    });
    expect(await ledger.payment(created.id)).toMatchObject({
      status: "paid",
      method: "lightning",
      bitcoin: leg,
      paidAtSec: expect.any(Number),
    });
  });

  it("keep the tip within the amount charged and who paid, and read older rows without either", async () => {
    const { ledger } = setup();
    const tipped = await ledger.createPayment(
      CzkAmount.make(13_178),
      CzkAmount.make(628),
    );
    const payerPubkey = makeIdentity().pubkey;
    expect(
      await ledger.completePayment(tipped, {
        cashuReceive: { operationId: "receive-1", sats: 99 },
        payerPubkey,
      }),
    ).toBe(true);
    expect(await ledger.payment(tipped.id)).toMatchObject({
      amountCzk: 13_178,
      tipCzk: 628,
      method: "cashu",
      payerPubkey,
    });
    const plain = await ledger.createPayment(CzkAmount.make(12_550));
    expect(await ledger.payment(plain.id)).toMatchObject({
      tipCzk: null,
      payerPubkey: null,
    });
  });

  it("can be paid after a cancel but never cancelled once paid", async () => {
    const { ledger } = setup();
    const created = await ledger.createPayment(CzkAmount.make(100));
    expect(await ledger.cancelPayment(created)).toBe(true);
    const cancelled = await ledger.payment(created.id);
    if (!cancelled) throw new Error("no payment");
    expect(cancelled.status).toBe("cancelled");
    expect(await ledger.completePayment(cancelled, "bank")).toBe(true);
    const paid = await ledger.payment(created.id);
    if (!paid) throw new Error("no payment");
    expect(await ledger.cancelPayment(paid)).toBe(false);
    expect(await ledger.completePayment(paid, "bank")).toBe(false);
  });

  it("keeps a quote's Cashu request when its Lightning quote expires", async () => {
    const { ledger } = setup();
    const created = await ledger.createPayment(CzkAmount.make(100));
    await ledger.attachBitcoinLeg(created, leg);
    const withLeg = await ledger.payment(created.id);
    if (!withLeg) throw new Error("no payment");
    await ledger.clearLightningQuote(withLeg);
    expect((await ledger.payment(created.id))?.bitcoin).toEqual({
      ...leg,
      quoteId: null,
      invoice: null,
    });
  });
});

describe("records", () => {
  it("skip the transaction rows Linky itself writes", async () => {
    const { ledger, repositories } = setup();
    await Effect.runPromise(
      repositories.transactions.insert({
        id: createId<"Transaction">(),
        createdAtSec: PositiveInt.orThrow(1_700_000_000),
        direction: NonEmptyString100.orThrow("in"),
        status: NonEmptyString100.orThrow("ok"),
        method: NonEmptyString100.orThrow("cashu_chat"),
        amount: PositiveInt.orThrow(21),
        detailsJson: NonEmptyString.orThrow('{"note":"from Linky"}'),
      }),
    );
    expect(await ledger.records()).toEqual({
      payments: [],
      receipts: [],
      directTransfers: [],
      withdrawals: [],
    });
  });

  it("record a receipt once per receive", async () => {
    const { ledger } = setup();
    expect(await ledger.hasReceipt("receive-1")).toBe(false);
    const receipt = {
      operationId: "receive-1",
      method: "cashu" as const,
      sats: 99,
      paymentId: null,
    };
    await ledger.recordReceipt(receipt);
    await ledger.recordReceipt({ ...receipt, sats: 50 });
    expect(await ledger.hasReceipt("receive-1")).toBe(true);
    expect((await ledger.records()).receipts).toMatchObject([
      { operationId: "receive-1", sats: 99 },
    ]);
  });
  it("record a direct transfer once per receive, its note in the row's note column", async () => {
    const { ledger, repositories } = setup();
    const payerPubkey = makeIdentity().pubkey;
    const transfer = {
      operationId: "receive-1",
      sats: 300,
      czkPerBtc: 2_500_000,
      mintUrl: testMint,
      payerPubkey,
      note: "Za kávu",
    };
    await ledger.recordDirectTransfer(transfer);
    await ledger.recordDirectTransfer({ ...transfer, sats: 50 });
    expect(await ledger.hasReceipt("receive-1")).toBe(true);
    const [row, ...others] = await Effect.runPromise(
      repositories.transactions.all,
    );
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      direction: "in",
      status: "ok",
      method: "cashu",
      amount: 300,
      mint: testMint,
      unit: "sat",
      note: "Za kávu",
    });
    expect(JSON.parse(row?.detailsJson ?? "")).toEqual({
      app: "fazole",
      kind: "direct",
      operationId: "receive-1",
      payerPubkey,
      czkPerBtc: 2_500_000,
    });
    expect((await ledger.records()).directTransfers).toMatchObject([
      { ...transfer, id: row?.id },
    ]);
  });
});

describe("withdrawals", () => {
  it("store a melt under the row Linky derives from its quote and close it once", async () => {
    const { ledger } = setup();
    const created = await ledger.createWithdrawal({
      kind: "lightning_invoice",
      target: "lnbc1test",
      amountSats: 333,
      feeSats: null,
      mintUrl: testMint,
      quoteId: "melt-quote",
      invoice: "lnbc1test",
    });
    expect(created.id).toBe(
      transactionIdForQuote(
        "melt",
        MintUrl.make(testMint),
        QuoteId.make("melt-quote"),
      ),
    );
    await ledger.finishWithdrawal(created.id, { status: "done", feeSats: 3 });
    await ledger.finishWithdrawal(created.id, {
      status: "failed",
      error: "late",
    });
    expect((await ledger.records()).withdrawals).toMatchObject([
      {
        kind: "lightning_invoice",
        status: "done",
        amountSats: 333,
        feeSats: 3,
        error: null,
      },
    ]);
  });
});
