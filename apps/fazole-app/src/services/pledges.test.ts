import {
  Amount,
  Bip39Seed,
  Envelope,
  EnvelopeKey,
  EnvelopeNotFound,
  EnvelopeOpened,
  EnvelopeReleased,
  EnvelopeState,
  EnvelopeToken,
  Inspector,
  InsufficientFunds,
  linkshuServices,
  MintBalance,
  MintUnreachable,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  TokenText,
  WalletBalances,
  type EnvelopeOpenError,
  type EnvelopeStatus,
} from "@linky-fit/linkshu";
import {
  ChatMessageReceipt,
  ClientId,
  encodeNpub,
  EnqueueReceipt,
  OutboxJobFailed,
  OutboxJobId,
  OutboxJobSucceeded,
  OutboxRef,
  RumorId,
  UnixSeconds,
  WrapDelivery,
  WrapId,
  type Pubkey,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CzkAmount, Sats } from "../domain";
import { savePledge } from "../storage/pledgeSetting";
import { createPledges } from "./pledges";
import { fakeNostr, setup, testMint } from "./testing/fakes";
import type { Wallet } from "./wallet";

const mint = MintUrl.make(testMint);
const pledger = makeIdentity().pubkey;
const contact = { pubkey: pledger, address: "hynek@linky.fit" };
// 2 500 000 Kč per BTC: a sat is 2,5 haléře, 100 Kč is 4 000 sat.
const rate = 2_500_000;
const czk = (haler: number) => CzkAmount.make(haler);

const enqueued = (ref: string, clientId?: ClientId) =>
  new EnqueueReceipt({
    jobId: OutboxJobId.make(ref),
    ref: OutboxRef.make(ref),
    rumorId: RumorId.make("ef".repeat(32)),
    clientId: clientId ?? ClientId.make(ref),
    sentAt: UnixSeconds.make(1_700_000_000),
  });

interface StoredFakeEnvelope {
  readonly operationId: OperationId;
  readonly amount: Amount;
  readonly tokenText: TokenText;
  status: EnvelopeStatus;
}

/**
 * Shared in-memory mint for envelopes: the first terminal to open a key
 * creates it and debits `balanceSats`; every later terminal adopts the same
 * envelope without touching funds again.
 */
const makeFakeEnvelopeMint = (
  options: {
    readonly balanceSats?: number;
    readonly inputFeePpk?: number;
    readonly proofCount?: number;
    readonly failOpenWith?: EnvelopeOpenError;
  } = {},
) => {
  const envelopes = new Map<string, StoredFakeEnvelope>();
  const openedAmounts: number[] = [];
  let balanceSats = options.balanceSats ?? 1_000_000;
  const inputFeePpk = options.inputFeePpk ?? 100;
  const proofCount = options.proofCount ?? 15;
  const swapFee = Math.ceil((inputFeePpk * proofCount) / 1000);

  const envelopeService = {
    open: (draft: { mint: MintUrl; key: EnvelopeKey; amount: Amount }) =>
      Effect.gen(function* () {
        openedAmounts.push(draft.amount);
        const existing = envelopes.get(draft.key);
        if (existing) {
          return new EnvelopeOpened({
            outcome: "adopted",
            operationId: existing.operationId,
            amount: existing.amount,
          });
        }
        if (options.failOpenWith)
          return yield* Effect.fail(options.failOpenWith);
        if (draft.amount + swapFee > balanceSats) {
          return yield* Effect.fail(
            new InsufficientFunds({
              mint: draft.mint,
              required: draft.amount,
              available: NonNegativeAmount.make(balanceSats),
            }),
          );
        }
        balanceSats -= draft.amount + swapFee;
        const created: StoredFakeEnvelope = {
          operationId: OperationId.make(`op:${draft.key}`),
          amount: draft.amount,
          tokenText: TokenText.make(`cashuB_${draft.key}_${draft.amount}`),
          status: "unspent",
        };
        envelopes.set(draft.key, created);
        return new EnvelopeOpened({
          outcome: "created",
          operationId: created.operationId,
          amount: created.amount,
        });
      }),
    state: (ref: { mint: MintUrl; key: EnvelopeKey }) =>
      Effect.sync(() => {
        const existing = envelopes.get(ref.key);
        return existing
          ? new EnvelopeState({
              status: existing.status,
              amount: NonNegativeAmount.make(existing.amount),
              operationId: existing.operationId,
            })
          : new EnvelopeState({
              status: "absent",
              amount: NonNegativeAmount.make(0),
              operationId: null,
            });
      }),
    send: (draft: { mint: MintUrl; key: EnvelopeKey }) =>
      Effect.gen(function* () {
        const existing = envelopes.get(draft.key);
        if (!existing) {
          return yield* Effect.fail(
            new EnvelopeNotFound({ mint: draft.mint, key: draft.key }),
          );
        }
        return new EnvelopeToken({
          operationId: existing.operationId,
          tokenText: existing.tokenText,
          amount: existing.amount,
        });
      }),
    release: () =>
      Effect.succeed(
        new EnvelopeReleased({ amount: NonNegativeAmount.make(0) }),
      ),
  };

  const runtime = ManagedRuntime.make(
    Layer.merge(
      linkshuServices({
        bip39Seed: Bip39Seed.make(new Uint8Array(64)),
      }).pipe(Layer.provideMerge(Inspector.disabled)),
      Layer.succeed(Envelope, envelopeService),
    ),
  );

  const walletWith = (
    base: Wallet,
    overrides: {
      readonly balanceOverride?: () => number;
      readonly operationMint?: (operationId: string) => Promise<MintUrl | null>;
    } = {},
  ): Wallet => ({
    ...base,
    run: (effect) => runtime.runPromise(Effect.result(effect)),
    balances: async () => {
      const amount = overrides.balanceOverride
        ? overrides.balanceOverride()
        : balanceSats;
      return new WalletBalances({
        total: NonNegativeAmount.make(amount),
        spendable: NonNegativeAmount.make(amount),
        perMint:
          amount > 0
            ? [
                new MintBalance({
                  mint,
                  amount: NonNegativeAmount.make(amount),
                }),
              ]
            : [],
      });
    },
    richestMint: async () => {
      const amount = overrides.balanceOverride
        ? overrides.balanceOverride()
        : balanceSats;
      return amount > 0 ? { mint, sats: amount } : null;
    },
    inputFeePpk: async () => inputFeePpk,
    availableProofCount: async () => proofCount,
    operationMint: overrides.operationMint ?? base.operationMint,
  });

  return {
    envelopes,
    openedAmounts,
    balance: () => balanceSats,
    walletWith,
    dispose: () => runtime.dispose(),
  };
};

const pledgesOver = (
  options: {
    readonly balanceSats?: number;
    readonly failOpenWith?: EnvelopeOpenError;
    readonly czkPerBtc?: number | null;
    readonly sharedMint?: ReturnType<typeof makeFakeEnvelopeMint>;
    readonly localBalance?: () => number;
    readonly operationMint?: (operationId: string) => Promise<MintUrl | null>;
  } = {},
) => {
  const { ledger, repositories, wallet: baseWallet } = setup();
  const fakeMint = options.sharedMint ?? makeFakeEnvelopeMint(options);
  const wallet = fakeMint.walletWith(baseWallet, {
    ...(options.localBalance === undefined
      ? {}
      : { balanceOverride: options.localBalance }),
    ...(options.operationMint === undefined
      ? {}
      : { operationMint: options.operationMint }),
  });
  const texts: { to: Pubkey; text: string; clientId: ClientId }[] = [];
  const tokens: {
    to: Pubkey;
    token: string;
    ref: string;
    clientId: ClientId | undefined;
  }[] = [];
  const notices: Pubkey[] = [];
  const queued = new Set<string>();
  const fake = fakeNostr({
    sendText: async (to, text, clientId, ref) => {
      texts.push({ to, text, clientId });
      return enqueued(ref, clientId);
    },
    sendToken: async (to, token, ref, clientId) => {
      tokens.push({ to, token, ref, clientId });
      queued.add(ref);
      return enqueued(ref, clientId);
    },
    sendPaymentNotice: async (to) => {
      notices.push(to);
    },
    queuedRefs: async () => new Set(queued),
  });
  const pledges = createPledges({
    ledger,
    settings: repositories.settings,
    nostr: fake.nostr,
    wallet,
    czkPerBtc: async () =>
      options.czkPerBtc === undefined ? rate : options.czkPerBtc,
    whenHydrated: () => Promise.resolve(),
  });
  const inflow = (
    sats: number,
    operationId = `receive-${sats}`,
    storedRate: number | null = rate,
  ) =>
    ledger.recordDirectTransfer({
      operationId,
      sats,
      czkPerBtc: storedRate,
      mintUrl: testMint,
      payerPubkey: makeIdentity().pubkey,
      note: null,
    });
  return {
    ledger,
    repositories,
    pledges,
    texts,
    tokens,
    notices,
    queued,
    outbox: fake.outbox,
    fakeMint,
    inflow,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("opening a pledge", () => {
  it("stores it, tells the pledger and refuses a second one", async () => {
    const { pledges, texts, fakeMint } = pledgesOver();
    const opened = await pledges.open(contact, czk(10_000));
    expect(opened).toMatchObject({
      pubkey: pledger,
      address: "hynek@linky.fit",
      amountCzk: 10_000,
    });
    expect(await pledges.current()).toEqual(opened);
    expect(texts).toMatchObject([
      { to: pledger, text: "Přijato do zástavy 100 Kč." },
    ]);
    await expect(
      pledges.open({ pubkey: makeIdentity().pubkey, address: null }, czk(1)),
    ).rejects.toThrow();
    expect(await pledges.current()).toEqual(opened);
    await fakeMint.dispose();
  });
});

describe("repaying a pledge", () => {
  it("forwards an inflow to the pledger, tells them what is left, and does it once", async () => {
    const { ledger, pledges, texts, tokens, fakeMint, inflow } = pledgesOver();
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
      pledge: {
        czk: 2_500,
        sources: [directTransfers[0]?.id],
        remainingCzk: 7_500,
      },
    });
    expect(tokens).toHaveLength(1);
    expect(texts.map(({ text }) => text)).toEqual([
      "Přijato do zástavy 100 Kč.",
      "Ze zástavy posláno 1\u00a0000 sat (≈ 25 Kč). Zbývá doplatit 75 Kč.",
    ]);
    expect(await pledges.current()).not.toBeNull();
    await fakeMint.dispose();
  });

  it("forwards only what is owed, then closes once the repayment reached the relay", async () => {
    const {
      ledger,
      pledges,
      texts,
      tokens,
      notices,
      outbox,
      fakeMint,
      inflow,
    } = pledgesOver();
    await pledges.open(contact, czk(10_000));
    await inflow(5_000);
    await pledges.reconcile();
    const [repayment] = (await ledger.records()).withdrawals;
    expect(repayment).toMatchObject({
      amountSats: 4_000,
      pledge: { czk: 10_000, remainingCzk: 0 },
    });
    expect(texts.at(-1)?.text).toBe(
      "Ze zástavy posláno 4\u00a0000 sat (≈ 100 Kč). Zástava 100 Kč je splacená.",
    );
    // Still open until the token is delivered.
    expect(await pledges.current()).not.toBeNull();
    const tokenJob = tokens[0];
    if (!tokenJob) throw new Error("no token job");
    const delivery = new WrapDelivery({
      wrapId: WrapId.make("cd".repeat(32)),
      acceptedBy: [],
      rejectedBy: [],
    });
    await outbox[0]?.handler(
      new OutboxJobSucceeded({
        jobId: OutboxJobId.make(tokenJob.ref),
        ref: OutboxRef.make(tokenJob.ref),
        receipt: new ChatMessageReceipt({
          rumorId: RumorId.make("ef".repeat(32)),
          clientId: tokenJob.clientId ?? ClientId.make("c"),
          sentAt: UnixSeconds.make(1_700_000_000),
          selfCopy: delivery,
          recipientCopy: delivery,
        }),
      }),
    );
    expect(notices).toEqual([pledger]);
    await pledges.reconcile();
    expect(await pledges.current()).toBeNull();
    await fakeMint.dispose();
  });

  it("sends what the balance allows when the fee does not fit next to the inflow", async () => {
    const { ledger, pledges, fakeMint, inflow } = pledgesOver({
      balanceSats: 1_000,
    });
    await pledges.open(contact, czk(10_000));
    await inflow(1_000);
    await pledges.reconcile();
    expect(fakeMint.openedAmounts).toEqual([998]);
    expect((await ledger.records()).withdrawals[0]).toMatchObject({
      amountSats: 998,
      pledge: { czk: 2_495 },
    });
    await fakeMint.dispose();
  });

  it("forwards once when two terminals race on the same inflow, keeping pre-existing balance intact", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    // 1,923 sat pre-existing + 1,000 sat inflow = 2,923 sat.
    const sharedMint = makeFakeEnvelopeMint({ balanceSats: 2_923 });
    const pos1 = pledgesOver({ sharedMint });
    const pos2 = pledgesOver({ sharedMint, czkPerBtc: 2_600_000 });

    const opened = await pos1.pledges.open(contact, czk(10_000));
    await Effect.runPromise(savePledge(pos2.repositories.settings, opened));
    await pos1.inflow(1_000, "shared-inflow");
    await pos2.inflow(1_000, "shared-inflow");

    await Promise.all([pos1.pledges.reconcile(), pos2.pledges.reconcile()]);

    // Only one 1,000 sat (+ 2 sat swap fee) envelope left the mint; 1,921 sat remain.
    expect(sharedMint.envelopes.size).toBe(1);
    expect(sharedMint.balance()).toBe(1_921);

    // Winner delivers once; loser defers during grace without writing a competing row or conflicting text.
    expect((await pos1.ledger.records()).withdrawals).toHaveLength(1);
    expect((await pos2.ledger.records()).withdrawals).toHaveLength(0);
    expect(pos1.tokens).toHaveLength(1);
    expect(pos2.tokens).toHaveLength(0);
    expect(pos1.texts[1]?.text).toBe(
      "Ze zástavy posláno 1\u00a0000 sat (≈ 25 Kč). Zbývá doplatit 75 Kč.",
    );
    expect(pos2.texts).toEqual([]);

    // If the creator died before syncing its row, the loser takes over past grace with the same ids and text.
    vi.setSystemTime(start + 35_000);
    await pos2.pledges.reconcile();
    const [w1] = (await pos1.ledger.records()).withdrawals;
    const [w2] = (await pos2.ledger.records()).withdrawals;
    expect(w2?.id).toBe(w1?.id);
    expect(pos2.tokens[0]?.token).toBe(pos1.tokens[0]?.token);
    expect(pos2.tokens[0]?.clientId).toBe(pos1.tokens[0]?.clientId);
    expect(pos2.texts[0]?.text).toBe(pos1.texts[1]?.text);
    expect(pos2.texts[0]?.clientId).toBe(pos1.texts[1]?.clientId);

    pos1.pledges.stop();
    pos2.pledges.stop();
    await sharedMint.dispose();
  });

  it("routes an old pledge's pending envelope token to its original pledger and skips text under a newer pledge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    const {
      ledger,
      repositories,
      pledges,
      tokens,
      texts,
      queued,
      fakeMint,
      inflow,
    } = pledgesOver();
    await pledges.open(contact, czk(2_500));
    await inflow(1_000, "old-pledge-inflow");
    await pledges.reconcile();
    expect(tokens).toHaveLength(1);
    const oldRow = (await ledger.records()).withdrawals[0];
    if (!oldRow) throw new Error("missing old repayment");

    // Old pledge closed and a new pledge opened to the SAME pledger while an old withdrawal is created late.
    await Effect.runPromise(savePledge(repositories.settings, null));
    vi.setSystemTime(start + 10_000);
    await pledges.open(contact, czk(5_000));
    // Re-stamp the old envelope row after the new pledge opened (simulating a stale terminal adopting it late).
    await ledger.createWithdrawal({
      kind: "cashu_chat",
      target: oldRow.target,
      amountSats: oldRow.amountSats,
      feeSats: null,
      mintUrl: oldRow.mintUrl,
      operationId: "late-old-envelope-op",
      pledge: oldRow.pledge ?? undefined,
    });
    queued.clear();
    const textsBeforeRecovery = texts.length;

    vi.setSystemTime(start + 55_000);
    await pledges.reconcile();

    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens.at(-1)?.to).toBe(pledger);
    // Old envelope key does not match the new pledge, so no misleading text is sent under the new pledge.
    expect(texts).toHaveLength(textsBeforeRecovery);

    pledges.stop();
    await fakeMint.dispose();
  });

  it("uses one envelope when one terminal records a NUT-18 receive on a payment and another as a direct transfer", async () => {
    const sharedMint = makeFakeEnvelopeMint({ balanceSats: 2_923 });
    const pos1 = pledgesOver({ sharedMint });
    const pos2 = pledgesOver({ sharedMint });

    const opened = await pos1.pledges.open(contact, czk(10_000));
    await Effect.runPromise(savePledge(pos2.repositories.settings, opened));

    // pos1 classifies the receive as a paid payment; pos2 records the same operationId as a direct transfer.
    const payment = await pos1.ledger.createPayment(czk(2_500));
    await pos1.ledger.attachBitcoinLeg(payment, {
      sats: Sats.make(1_000),
      czkPerBtc: rate,
      mintUrl: testMint,
      paymentRequest: "creqAtest",
      quoteId: null,
      invoice: null,
    });
    const withLeg = await pos1.ledger.payment(payment.id);
    if (!withLeg) throw new Error("missing payment");
    await pos1.ledger.completePayment(withLeg, {
      cashuReceive: { operationId: "same-cashu-receive-op", sats: 1_000 },
    });
    await pos2.inflow(1_000, "same-cashu-receive-op");

    await Promise.all([pos1.pledges.reconcile(), pos2.pledges.reconcile()]);

    expect(sharedMint.envelopes.size).toBe(1);
    expect(sharedMint.balance()).toBe(1_921);
    expect(pos1.tokens.length + pos2.tokens.length).toBe(1);

    // Syncing pos1's withdrawal (naming the payment id) onto pos2 covers pos2's direct-transfer
    // classification via envelopeKey too, so newer inflows on pos2 still forward without stalling.
    const [w1] = (await pos1.ledger.records()).withdrawals;
    if (!w1 || !w1.operationId || !w1.pledge)
      throw new Error("missing winner withdrawal");
    await pos2.ledger.createWithdrawal({
      kind: "cashu_chat",
      target: w1.target,
      amountSats: w1.amountSats,
      feeSats: null,
      mintUrl: w1.mintUrl,
      operationId: w1.operationId,
      status: "done",
      pledge: w1.pledge,
    });
    await pos2.inflow(500, "newer-inflow-after-dup");
    await pos2.pledges.reconcile();
    expect(sharedMint.envelopes.size).toBe(2);

    pos1.pledges.stop();
    pos2.pledges.stop();
    await sharedMint.dispose();
  });

  it("never double-forwards a shared mint-B inflow when terminals disagree on an earlier mint-A repayment", async () => {
    const mintA = MintUrl.make("http://localhost:3338");
    const mintB = MintUrl.make("http://localhost:3339");
    const envelopes = new Map<string, StoredFakeEnvelope>();
    const runtime = ManagedRuntime.make(
      Layer.merge(
        linkshuServices({
          bip39Seed: Bip39Seed.make(new Uint8Array(64)),
        }).pipe(Layer.provideMerge(Inspector.disabled)),
        Layer.succeed(Envelope, {
          open: (draft) => {
            const composite = `${draft.mint}:${draft.key}`;
            const existing = envelopes.get(composite);
            if (existing) {
              return Effect.succeed(
                new EnvelopeOpened({
                  outcome: "adopted",
                  operationId: existing.operationId,
                  amount: existing.amount,
                }),
              );
            }
            const created: StoredFakeEnvelope = {
              operationId: OperationId.make(`op:${composite}`),
              amount: draft.amount,
              tokenText: TokenText.make(`cashuB_${composite}`),
              status: "unspent",
            };
            envelopes.set(composite, created);
            return Effect.succeed(
              new EnvelopeOpened({
                outcome: "created",
                operationId: created.operationId,
                amount: created.amount,
              }),
            );
          },
          state: (ref) => {
            const existing = envelopes.get(`${ref.mint}:${ref.key}`);
            return Effect.succeed(
              existing
                ? new EnvelopeState({
                    status: existing.status,
                    amount: NonNegativeAmount.make(existing.amount),
                    operationId: existing.operationId,
                  })
                : new EnvelopeState({
                    status: "absent",
                    amount: NonNegativeAmount.make(0),
                    operationId: null,
                  }),
            );
          },
          send: (draft) => {
            const existing = envelopes.get(`${draft.mint}:${draft.key}`);
            if (!existing) {
              return Effect.fail(
                new EnvelopeNotFound({ mint: draft.mint, key: draft.key }),
              );
            }
            return Effect.succeed(
              new EnvelopeToken({
                operationId: existing.operationId,
                tokenText: existing.tokenText,
                amount: existing.amount,
              }),
            );
          },
          release: () =>
            Effect.succeed(
              new EnvelopeReleased({ amount: NonNegativeAmount.make(0) }),
            ),
        }),
      ),
    );
    const makeMultiMintTerminal = () => {
      const { ledger, repositories, wallet: base } = setup();
      const wallet: Wallet = {
        ...base,
        run: (effect) => runtime.runPromise(Effect.result(effect)),
        balances: async () =>
          new WalletBalances({
            total: NonNegativeAmount.make(4_000),
            spendable: NonNegativeAmount.make(2_000),
            perMint: [
              new MintBalance({
                mint: mintA,
                amount: NonNegativeAmount.make(2_000),
              }),
              new MintBalance({
                mint: mintB,
                amount: NonNegativeAmount.make(2_000),
              }),
            ],
          }),
        inputFeePpk: async () => 0,
        availableProofCount: async () => 1,
      };
      const tokens: { token: string }[] = [];
      const pledges = createPledges({
        ledger,
        settings: repositories.settings,
        nostr: fakeNostr({
          sendToken: async (_to, token, ref, clientId) => {
            tokens.push({ token });
            return enqueued(ref, clientId);
          },
          sendText: async (_to, _text, clientId, ref) =>
            enqueued(ref, clientId),
        }).nostr,
        wallet,
        czkPerBtc: async () => rate,
        whenHydrated: () => Promise.resolve(),
      });
      return { ledger, repositories, pledges, tokens };
    };

    const pos1 = makeMultiMintTerminal();
    const pos2 = makeMultiMintTerminal();
    const opened = await pos1.pledges.open(contact, czk(10_000));
    await Effect.runPromise(savePledge(pos2.repositories.settings, opened));

    // pos1 already forwarded an earlier mint-A inflow; pos2 has not synced it yet.
    await pos1.ledger.recordDirectTransfer({
      operationId: "inflow-mint-a",
      sats: 1_000,
      czkPerBtc: rate,
      mintUrl: mintA,
      payerPubkey: makeIdentity().pubkey,
      note: null,
    });
    await pos1.pledges.reconcile();

    // Now both terminals receive the same mint-B inflow and race to forward it.
    const mintBInflow = {
      operationId: "inflow-mint-b",
      sats: 1_000,
      czkPerBtc: rate,
      mintUrl: mintB,
      payerPubkey: makeIdentity().pubkey,
      note: null,
    };
    await pos1.ledger.recordDirectTransfer(mintBInflow);
    await pos2.ledger.recordDirectTransfer(mintBInflow);
    await Promise.all([pos1.pledges.reconcile(), pos2.pledges.reconcile()]);

    // Exactly one envelope on mintA and one envelope on mintB (never two on mintB).
    const mintBEnvelopes = [...envelopes.keys()].filter((k) =>
      k.startsWith(`${mintB}:`),
    );
    expect(mintBEnvelopes).toHaveLength(1);

    pos1.pledges.stop();
    pos2.pledges.stop();
    await runtime.dispose();
  });

  it("defers a legacy receipt without a recorded mint until its wallet operation mint is known", async () => {
    let knownMint: MintUrl | null = null;
    const { ledger, pledges, fakeMint } = pledgesOver({
      operationMint: async () => knownMint,
    });
    await pledges.open(contact, czk(10_000));
    await ledger.recordReceipt({
      operationId: "legacy-receipt-op",
      method: "cashu",
      sats: 1_000,
      mintUrl: null,
      paymentId: null,
    });

    // Without the operation's mint, nothing is forwarded (never guesses with richestMint).
    await pledges.reconcile();
    expect(fakeMint.envelopes.size).toBe(0);
    expect((await ledger.records()).withdrawals).toEqual([]);

    // Once the operation syncs and the retry window passes, it forwards from that mint.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    knownMint = mint;
    await pledges.reconcile();
    expect(fakeMint.envelopes.size).toBe(1);
    expect((await ledger.records()).withdrawals).toHaveLength(1);

    pledges.stop();
    await fakeMint.dispose();
  });

  it("adopts an already-spent envelope directly as done after grace even when local balance synced to zero", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    const sharedMint = makeFakeEnvelopeMint({ balanceSats: 1_000 });
    const pos1 = pledgesOver({ sharedMint });
    const pos2 = pledgesOver({ sharedMint, localBalance: () => 0 });

    const opened = await pos1.pledges.open(contact, czk(10_000));
    await Effect.runPromise(savePledge(pos2.repositories.settings, opened));
    await pos1.inflow(1_000, "shared-inflow");
    await pos2.inflow(1_000, "shared-inflow");

    // pos1 funds the envelope and the recipient already redeems it before pos2 reconciles.
    await pos1.pledges.reconcile();
    for (const envelope of sharedMint.envelopes.values()) {
      envelope.status = "spent";
    }
    // Within grace: defers so pos1's authoritative withdrawal row can sync without being overwritten.
    await pos2.pledges.reconcile();
    expect((await pos2.ledger.records()).withdrawals).toEqual([]);

    // Past grace (winner failed to sync): records directly as done without re-sending.
    vi.setSystemTime(start + 35_000);
    await pos2.pledges.reconcile();
    const [w2] = (await pos2.ledger.records()).withdrawals;
    expect(w2).toMatchObject({ status: "done", amountSats: 998 });
    expect(pos2.tokens).toEqual([]);
    expect(pos2.texts).toEqual([]);

    pos1.pledges.stop();
    pos2.pledges.stop();
    await sharedMint.dispose();
  });

  it("repairs a pending envelope withdrawal to done even after the pledge closed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    const { ledger, repositories, pledges, queued, fakeMint, inflow } =
      pledgesOver();
    await pledges.open(contact, czk(2_500));
    await inflow(1_000, "inflow-1");
    await pledges.reconcile();

    // Pledge closed elsewhere and the recipient redeemed the token, while this device still has the row pending.
    await Effect.runPromise(savePledge(repositories.settings, null));
    queued.clear();
    for (const envelope of fakeMint.envelopes.values()) {
      envelope.status = "spent";
    }

    vi.setSystemTime(start + 35_000);
    await pledges.reconcile();
    expect((await ledger.records()).withdrawals[0]?.status).toBe("done");

    pledges.stop();
    await fakeMint.dispose();
  });

  it("uses distinct clientIds for envelopes funded on different mints", async () => {
    const secondMint = MintUrl.make("http://localhost:3339");
    const mintA = makeFakeEnvelopeMint({ balanceSats: 2_000 });
    const mintB = makeFakeEnvelopeMint({ balanceSats: 2_000 });
    const pos1 = pledgesOver({ sharedMint: mintA });
    const pos2 = pledgesOver({ sharedMint: mintB });
    // Override pos2's mint to secondMint for its inflow and balances.
    const opened = await pos1.pledges.open(contact, czk(10_000));
    await Effect.runPromise(savePledge(pos2.repositories.settings, opened));

    await pos1.inflow(1_000, "inflow-a");
    await pos1.pledges.reconcile();

    // Give pos2 a direct transfer on secondMint with a distinct operationId at mintB.
    const pos2Wallet: Wallet = {
      ...mintB.walletWith(setup().wallet),
      balances: async () =>
        new WalletBalances({
          total: NonNegativeAmount.make(2_000),
          spendable: NonNegativeAmount.make(2_000),
          perMint: [
            new MintBalance({
              mint: secondMint,
              amount: NonNegativeAmount.make(2_000),
            }),
          ],
        }),
    };
    const pos2Tokens: { clientId: ClientId | undefined }[] = [];
    const pos2Runtime = ManagedRuntime.make(
      Layer.merge(
        linkshuServices({
          bip39Seed: Bip39Seed.make(new Uint8Array(64)),
        }).pipe(Layer.provideMerge(Inspector.disabled)),
        Layer.succeed(Envelope, {
          open: (draft) =>
            Effect.succeed(
              new EnvelopeOpened({
                outcome: "created",
                operationId: OperationId.make(`op:${draft.mint}:${draft.key}`),
                amount: draft.amount,
              }),
            ),
          state: () =>
            Effect.succeed(
              new EnvelopeState({
                status: "unspent",
                amount: NonNegativeAmount.make(1_000),
                operationId: OperationId.make("op-other"),
              }),
            ),
          send: (draft) =>
            Effect.succeed(
              new EnvelopeToken({
                operationId: OperationId.make(`op:${draft.mint}:${draft.key}`),
                tokenText: TokenText.make("cashuB_mintB"),
                amount: Amount.make(1_000),
              }),
            ),
          release: () =>
            Effect.succeed(
              new EnvelopeReleased({ amount: NonNegativeAmount.make(0) }),
            ),
        }),
      ),
    );
    const pos2Other = createPledges({
      ledger: pos2.ledger,
      settings: pos2.repositories.settings,
      nostr: fakeNostr({
        sendToken: async (_to, _token, ref, clientId) => {
          pos2Tokens.push({ clientId });
          return enqueued(ref, clientId);
        },
        sendText: async (_to, _text, clientId, ref) => enqueued(ref, clientId),
      }).nostr,
      wallet: {
        ...pos2Wallet,
        run: (effect) => pos2Runtime.runPromise(Effect.result(effect)),
      },
      czkPerBtc: async () => rate,
      whenHydrated: () => Promise.resolve(),
    });
    await pos2.ledger.recordDirectTransfer({
      operationId: "inflow-b",
      sats: 1_000,
      czkPerBtc: rate,
      mintUrl: secondMint,
      payerPubkey: makeIdentity().pubkey,
      note: null,
    });
    await pos2Other.reconcile();

    expect(pos1.tokens[0]?.clientId).toBeDefined();
    expect(pos2Tokens[0]?.clientId).toBeDefined();
    expect(pos1.tokens[0]?.clientId).not.toBe(pos2Tokens[0]?.clientId);

    pos1.pledges.stop();
    pos2.pledges.stop();
    pos2Other.stop();
    await pos2Runtime.dispose();
    await mintA.dispose();
    await mintB.dispose();
  });

  it("does not forward an inflow again when a synced withdrawal arrives mid-reconcile", async () => {
    const { ledger, pledges, fakeMint, inflow } = pledgesOver();
    await pledges.open(contact, czk(10_000));
    await inflow(1_000, "inflow-1");
    await inflow(1_000, "inflow-2");
    const { directTransfers } = await ledger.records();
    expect(directTransfers).toHaveLength(2);

    // Simulate another terminal's withdrawal covering the second inflow arriving while the first is forwarding.
    const originalCreate = ledger.createWithdrawal;
    let syncedOther = false;
    const syncedLedger = {
      ...ledger,
      createWithdrawal: async (
        input: Parameters<typeof ledger.createWithdrawal>[0],
      ) => {
        const created = await originalCreate(input);
        if (!syncedOther) {
          syncedOther = true;
          const other = directTransfers.find(
            (transfer) =>
              !(input.pledge?.sources.includes(transfer.id) ?? false),
          );
          if (!other) throw new Error("missing second inflow");
          await originalCreate({
            kind: "cashu_chat",
            target: encodeNpub(pledger),
            amountSats: 1_000,
            feeSats: null,
            mintUrl: testMint,
            operationId: "op-remote-step",
            status: "done",
            pledge: { czk: czk(2_500), sources: [other.id] },
          });
        }
        return created;
      },
    };
    const { repositories, wallet: baseWallet } = setup();
    const opened = await pledges.current();
    if (!opened) throw new Error("no pledge");
    await Effect.runPromise(savePledge(repositories.settings, opened));
    const racingPledges = createPledges({
      ledger: syncedLedger,
      settings: repositories.settings,
      nostr: fakeNostr({
        sendToken: async (_to, _token, ref, clientId) =>
          enqueued(ref, clientId),
        sendText: async (_to, _text, clientId, ref) => enqueued(ref, clientId),
      }).nostr,
      wallet: fakeMint.walletWith(baseWallet),
      czkPerBtc: async () => rate,
      whenHydrated: () => Promise.resolve(),
    });

    await racingPledges.reconcile();
    // Only inflow-1 was forwarded locally; inflow-2 was already covered by the synced withdrawal.
    expect(fakeMint.envelopes.size).toBe(1);

    pledges.stop();
    racingPledges.stop();
    await fakeMint.dispose();
  });

  it("resumes both token and text after the grace period, or closes once spent at the mint", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.now();
    const { ledger, pledges, tokens, texts, queued, fakeMint, inflow } =
      pledgesOver();
    await pledges.open(contact, czk(10_000));
    await inflow(1_000, "inflow-1");
    await pledges.reconcile();
    expect(tokens).toHaveLength(1);
    expect(texts).toHaveLength(2);

    // Simulate a reload where the local outbox lost the job while the withdrawal is still pending.
    queued.clear();
    // Within grace period: waits for the original terminal before re-queuing.
    await pledges.reconcile();
    expect(tokens).toHaveLength(1);

    // Past grace period: re-queues both the token and the exact same repayment text with matching clientIds.
    vi.setSystemTime(start + 35_000);
    await pledges.reconcile();
    expect(tokens).toHaveLength(2);
    expect(tokens[1]?.token).toBe(tokens[0]?.token);
    expect(tokens[1]?.clientId).toBe(tokens[0]?.clientId);
    expect(texts).toHaveLength(3);
    expect(texts[2]?.text).toBe(texts[1]?.text);
    expect(texts[2]?.clientId).toBe(texts[1]?.clientId);

    // Once the recipient redeems it at the mint, a later reconcile marks it done without re-sending.
    queued.clear();
    for (const envelope of fakeMint.envelopes.values()) {
      envelope.status = "spent";
    }
    await pledges.reconcile();
    expect((await ledger.records()).withdrawals[0]?.status).toBe("done");
    expect(tokens).toHaveLength(2);

    pledges.stop();
    await fakeMint.dispose();
  });

  it("keeps a pending envelope repayment for retry when the outbox reports a failure", async () => {
    const { ledger, pledges, tokens, outbox, fakeMint, inflow } = pledgesOver();
    await pledges.open(contact, czk(10_000));
    await inflow(1_000);
    await pledges.reconcile();
    const job = tokens[0];
    if (!job) throw new Error("no token job");
    await outbox[0]?.handler(
      new OutboxJobFailed({
        jobId: OutboxJobId.make(job.ref),
        ref: OutboxRef.make(job.ref),
        reason: "unexpected-error",
        detail: "offline",
      }),
    );
    expect((await ledger.records()).withdrawals[0]?.status).toBe("pending");
    pledges.stop();
    await fakeMint.dispose();
  });

  it("backs off a failing inflow without writing a failed withdrawal row", async () => {
    const { ledger, pledges, fakeMint, inflow } = pledgesOver({
      failOpenWith: new MintUnreachable({ mint, detail: "offline" }),
    });
    await pledges.open(contact, czk(10_000));
    await inflow(1_000);
    await pledges.reconcile();
    await pledges.reconcile();
    expect((await ledger.records()).withdrawals).toEqual([]);
    // Held back for the retry window, so the mint is not hammered on every change.
    expect(fakeMint.openedAmounts).toEqual([1_000]);
    pledges.stop();
    await fakeMint.dispose();
  });

  it("waits for the rate when neither the inflow nor the ticker has one, and leaves older inflows alone", async () => {
    const withoutRate = pledgesOver({ czkPerBtc: null });
    await withoutRate.inflow(1_000, "old", null);
    await withoutRate.pledges.open(contact, czk(10_000));
    await withoutRate.inflow(1_000, "rateless", null);
    await withoutRate.pledges.reconcile();
    expect((await withoutRate.ledger.records()).withdrawals).toEqual([]);
    withoutRate.pledges.stop();
    await withoutRate.fakeMint.dispose();
  });

  it("does nothing without a pledge", async () => {
    const { ledger, pledges, fakeMint, inflow } = pledgesOver();
    await inflow(1_000);
    await pledges.reconcile();
    expect(fakeMint.openedAmounts).toEqual([]);
    expect((await ledger.records()).withdrawals).toEqual([]);
    await fakeMint.dispose();
  });
});
