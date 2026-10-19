import { MintUrl } from "@linky-fit/linkshu";
import {
  ClientId,
  encodeNpub,
  EnqueueReceipt,
  OutboxJobId,
  OutboxRef,
  RumorId,
  UnixSeconds,
  type Pubkey,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { CzkAmount } from "../domain";
import type { Ledger } from "../storage/ledger";
import { createPledges } from "./pledges";
import { fakeNostr, setup, testMint } from "./testing/fakes";
import type {
  WithdrawalQuote,
  Withdrawals,
  WithdrawFailure,
} from "./withdrawals";

const pledger = makeIdentity().pubkey;
const contact = { pubkey: pledger, address: "hynek@linky.fit" };
// 2 500 000 Kč per BTC: a sat is 2,5 haléře, 100 Kč is 4 000 sat.
const rate = 2_500_000;
const czk = (haler: number) => CzkAmount.make(haler);

const enqueued = (ref: string) =>
  new EnqueueReceipt({
    jobId: OutboxJobId.make(ref),
    ref: OutboxRef.make(ref),
    rumorId: RumorId.make("ef".repeat(32)),
    clientId: ClientId.make(ref),
    sentAt: UnixSeconds.make(1_700_000_000),
  });

/** Withdrawals that charge 2 sat per send and record every execution in the ledger. */
const fakeWithdrawals = (
  ledger: Ledger,
  options: {
    /** The balance a send can take at most; a bigger amount fails as insufficient. */
    readonly balanceSats?: number;
    readonly failWith?: WithdrawFailure;
  } = {},
) => {
  const quotes: (number | undefined)[] = [];
  const quoteOf = (
    target: WithdrawalQuote["target"],
    amountSats: number,
    wholeBalance: boolean,
  ): WithdrawalQuote => ({
    target,
    mint: MintUrl.make(testMint),
    amountSats,
    feeSats: 2,
    totalSats: amountSats + 2,
    wholeBalance,
    plan: {
      kind: "send",
      to: target.kind === "cashu_chat" ? target.pubkey : pledger,
    },
  });
  const withdrawals: Withdrawals = {
    quote: async (target, requested) => {
      quotes.push(requested?.amountSats);
      if (options.failWith) return Result.fail(options.failWith);
      const balance = options.balanceSats ?? Number.POSITIVE_INFINITY;
      const amount = requested?.amountSats;
      if (amount === undefined) {
        return Result.succeed(quoteOf(target, balance - 2, true));
      }
      return amount + 2 > balance
        ? Result.fail("insufficient-funds")
        : Result.succeed(quoteOf(target, amount, false));
    },
    execute: async (quote, executeOptions) => {
      const withdrawal = await ledger.createWithdrawal({
        kind: "cashu_chat",
        target: quote.target.kind === "cashu_chat" ? quote.target.npub : "",
        amountSats: quote.amountSats,
        feeSats: quote.feeSats,
        mintUrl: quote.mint,
        pledge: executeOptions?.pledge,
      });
      return Result.succeed({ status: "pending", withdrawal });
    },
    resume: async () => {},
  };
  return { withdrawals, quotes };
};

const pledgesOver = (
  options: {
    readonly balanceSats?: number;
    readonly failWith?: WithdrawFailure;
    readonly czkPerBtc?: number | null;
  } = {},
) => {
  const { ledger, repositories } = setup();
  const texts: { to: Pubkey; text: string }[] = [];
  const { nostr } = fakeNostr({
    sendText: async (to, text, _clientId, ref) => {
      texts.push({ to, text });
      return enqueued(ref);
    },
  });
  const { withdrawals, quotes } = fakeWithdrawals(ledger, options);
  const pledges = createPledges({
    ledger,
    settings: repositories.settings,
    nostr,
    withdrawals,
    czkPerBtc: async () =>
      options.czkPerBtc === undefined ? rate : options.czkPerBtc,
    whenHydrated: () => Promise.resolve(),
  });
  const inflow = (sats: number, operationId = `receive-${sats}`) =>
    ledger.recordDirectTransfer({
      operationId,
      sats,
      czkPerBtc: rate,
      mintUrl: testMint,
      payerPubkey: makeIdentity().pubkey,
      note: null,
    });
  return { ledger, pledges, texts, quotes, inflow };
};

describe("opening a pledge", () => {
  it("stores it, tells the pledger and refuses a second one", async () => {
    const { pledges, texts } = pledgesOver();
    const opened = await pledges.open(contact, czk(10_000));
    expect(opened).toMatchObject({
      pubkey: pledger,
      address: "hynek@linky.fit",
      amountCzk: 10_000,
    });
    expect(await pledges.current()).toEqual(opened);
    expect(texts).toEqual([
      { to: pledger, text: "Přijato do zástavy 100 Kč." },
    ]);
    await expect(
      pledges.open({ pubkey: makeIdentity().pubkey, address: null }, czk(1)),
    ).rejects.toThrow();
    expect(await pledges.current()).toEqual(opened);
  });
});

describe("repaying a pledge", () => {
  it("forwards an inflow to the pledger, tells them what is left, and does it once", async () => {
    const { ledger, pledges, texts, inflow } = pledgesOver();
    await pledges.open(contact, czk(10_000));
    await inflow(1_000);
    await pledges.reconcile();
    await pledges.reconcile();
    const { withdrawals, directTransfers } = await ledger.records();
    expect(withdrawals).toHaveLength(1);
    expect(withdrawals[0]).toMatchObject({
      kind: "cashu_chat",
      target: encodeNpub(pledger),
      amountSats: 1_000,
      status: "pending",
      pledge: { czk: 2_500, sources: [directTransfers[0]?.id] },
    });
    expect(texts.map(({ text }) => text)).toEqual([
      "Přijato do zástavy 100 Kč.",
      "Ze zástavy posláno 1\u00a0000 sat (≈ 25 Kč). Zbývá doplatit 75 Kč.",
    ]);
    expect(await pledges.current()).not.toBeNull();
  });

  it("forwards only what is owed, then closes once the repayment reached the relay", async () => {
    const { ledger, pledges, texts, inflow } = pledgesOver();
    await pledges.open(contact, czk(10_000));
    await inflow(5_000);
    await pledges.reconcile();
    const [repayment] = (await ledger.records()).withdrawals;
    expect(repayment).toMatchObject({
      amountSats: 4_000,
      pledge: { czk: 10_000 },
    });
    expect(texts.at(-1)?.text).toBe(
      "Ze zástavy posláno 4\u00a0000 sat (≈ 100 Kč). Zástava 100 Kč je splacená.",
    );
    // Still open until the token is delivered: a failed delivery brings the debt back.
    expect(await pledges.current()).not.toBeNull();
    if (!repayment) throw new Error("no repayment");
    await ledger.finishWithdrawal(repayment.id, { status: "done" });
    await pledges.reconcile();
    expect(await pledges.current()).toBeNull();
  });

  it("sends what the balance allows when the fee does not fit next to the inflow", async () => {
    const { ledger, pledges, quotes, inflow } = pledgesOver({
      balanceSats: 1_000,
    });
    await pledges.open(contact, czk(10_000));
    await inflow(1_000);
    await pledges.reconcile();
    expect(quotes).toEqual([1_000, undefined]);
    expect((await ledger.records()).withdrawals[0]).toMatchObject({
      amountSats: 998,
      pledge: { czk: 2_495 },
    });
  });

  it("forwards an inflow again after a failed repayment gave its sats back", async () => {
    const { ledger, pledges, inflow } = pledgesOver();
    await pledges.open(contact, czk(10_000));
    await inflow(1_000);
    await pledges.reconcile();
    const [first] = (await ledger.records()).withdrawals;
    if (!first) throw new Error("no repayment");
    await ledger.finishWithdrawal(first.id, { status: "failed", error: "x" });
    // Held back for the retry window, so a refusing mint is not hammered.
    await pledges.reconcile();
    expect((await ledger.records()).withdrawals).toHaveLength(1);
    pledges.stop();
  });

  it("waits for the rate and for the mint, and leaves inflows older than the pledge alone", async () => {
    const withoutRate = pledgesOver({ czkPerBtc: null });
    await withoutRate.inflow(1_000);
    await withoutRate.pledges.open(contact, czk(10_000));
    await withoutRate.pledges.reconcile();
    expect((await withoutRate.ledger.records()).withdrawals).toEqual([]);
    withoutRate.pledges.stop();

    const unreachable = pledgesOver({ failWith: "mint-unreachable" });
    await unreachable.pledges.open(contact, czk(10_000));
    await unreachable.inflow(1_000);
    await unreachable.pledges.reconcile();
    expect((await unreachable.ledger.records()).withdrawals).toEqual([]);
    expect(unreachable.quotes).toEqual([1_000]);
    unreachable.pledges.stop();
  });

  it("does nothing without a pledge", async () => {
    const { ledger, pledges, quotes, inflow } = pledgesOver();
    await inflow(1_000);
    await pledges.reconcile();
    expect(quotes).toEqual([]);
    expect((await ledger.records()).withdrawals).toEqual([]);
  });
});
