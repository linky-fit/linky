/**
 * Runs the terminal's wallet against Linky's local dev mint
 * (`docker compose -f docker-compose.dev.yml up -d --wait` from the repo
 * root), whose FakeWallet settles every invoice it issues after a few
 * seconds. Skipped when that mint does not answer.
 */
import {
  Amount,
  Bolt11Invoice,
  encodePaymentRequestPayload,
  MintUrl,
  PaymentRequestId,
  Send,
  SendDraft,
  Topup,
  TopupDraft,
} from "@linky-fit/linkshu";
import {
  ChatMessageReceived,
  ClientId,
  EnqueueReceipt,
  OutboxJobId,
  OutboxRef,
  RumorId,
  TextBody,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  balanceChange,
  buildCashuRequest,
  CzkAmount,
  Sats,
  walletActivity,
} from "../domain";
import { makeLedger } from "../storage/ledger";
import { savePledge } from "../storage/pledgeSetting";
import { makeRepositories } from "../storage/repositories";
import { createBitcoinPayments } from "./bitcoinPayments";
import { createPledges } from "./pledges";
import { makeLinkshuRuntime } from "./runtimes";
import {
  fakeNostr,
  setup,
  testAccount,
  testMint,
  testStore,
} from "./testing/fakes";
import { createWallet, type Wallet } from "./wallet";
import { createWithdrawals } from "./withdrawals";

const mint = MintUrl.make(testMint);
const czkPerBtc = 2_500_000;

const mintAnswers = await fetch(`${mint}/v1/info`, {
  signal: AbortSignal.timeout(1_000),
}).then(
  (response) => response.ok,
  () => false,
);

const succeed = <A, E>(outcome: Result.Result<A, E>): A => {
  if (Result.isFailure(outcome)) {
    throw new Error(JSON.stringify(outcome.failure));
  }
  return outcome.success;
};

/** A customer's wallet at the local mint, funded over Lightning. */
const customerWallet = async (sats: number) => {
  const { wallet } = setup();
  const invoiceFor = (amount: number) =>
    wallet.run(
      Effect.scoped(
        Effect.map(
          Effect.flatMap(Topup, (topup) =>
            topup.start(new TopupDraft({ mint, amount: Amount.make(amount) })),
          ),
          (handle) => handle.quote.invoice,
        ),
      ),
    );
  succeed(
    await wallet.run(
      Effect.scoped(
        Effect.flatMap(
          Effect.flatMap(Topup, (topup) =>
            topup.start(new TopupDraft({ mint, amount: Amount.make(sats) })),
          ),
          (handle) => handle.result,
        ),
      ),
    ),
  );
  /** The NUT-18 payload paying the request `requestId`. */
  const payload = async (requestId: string, amount: number) => {
    const receipt = succeed(
      await wallet.run(
        Effect.flatMap(Send, (send) =>
          send.send(
            new SendDraft({
              mint,
              amount: Amount.make(amount),
              produceAs: "issued",
              includeRecipientFee: true,
            }),
          ),
        ),
      ),
    );
    return encodePaymentRequestPayload({
      id: PaymentRequestId.make(requestId),
      mint: receipt.mint,
      unit: receipt.unit,
      proofs: receipt.proofs,
    });
  };
  return {
    payload,
    invoiceFor: async (amount: number) => succeed(await invoiceFor(amount)),
  };
};

const payloadMessage = (text: string) =>
  new ChatMessageReceived({
    messageId: RumorId.make("ab".repeat(32)),
    from: makeIdentity().pubkey,
    body: new TextBody({ text }),
    replyTo: null,
    root: null,
    editOf: null,
    clientId: null,
    sentAt: UnixSeconds.make(1_700_000_000),
  });

const balanceOf = async (wallet: Wallet) => (await wallet.balances()).total;

describe.runIf(mintAnswers)("the terminal at the local mint", () => {
  it(
    "takes Lightning and Cashu payments, withdraws the whole balance, and its activity adds up",
    { timeout: 120_000 },
    async () => {
      const { ledger, wallet } = setup();
      const sentTokens: string[] = [];
      const fake = fakeNostr({
        sendToken: async (_to, token, ref) => {
          sentTokens.push(token);
          return new EnqueueReceipt({
            jobId: OutboxJobId.make(ref),
            ref: OutboxRef.make(ref),
            rumorId: RumorId.make("ef".repeat(32)),
            clientId: ClientId.make(ref),
            sentAt: UnixSeconds.make(1_700_000_000),
          });
        },
      });
      const payments = createBitcoinPayments({
        ledger,
        nostr: fake.nostr,
        wallet,
        czkPerBtc: async () => czkPerBtc,
        mintUrl: async () => mint,
        shopName: async () => "Kavárna",
        whenHydrated: async () => {},
      });
      const withdrawals = createWithdrawals({
        ledger,
        nostr: fake.nostr,
        wallet,
      });
      const [deliverChat] = fake.inbox;
      if (!deliverChat) throw new Error("no inbox handler");
      const customer = await customerWallet(3_000);
      const statusOf = async (id: string) => (await ledger.payment(id))?.status;

      // Lightning: the FakeWallet settles the invoice by itself.
      const lightning = await ledger.createPayment(CzkAmount.make(2_500));
      expect(await payments.request(lightning.id)).toBeNull();
      await expect
        .poll(() => statusOf(lightning.id), { timeout: 30_000 })
        .toBe("paid");
      expect((await ledger.payment(lightning.id))?.method).toBe("lightning");

      // Cashu: a payload pays the request its id names; here the request has no invoice to race it.
      const cashu = await ledger.createPayment(CzkAmount.make(1_000));
      await ledger.attachBitcoinLeg(cashu, {
        sats: Sats.make(400),
        czkPerBtc,
        mintUrl: mint,
        quoteId: null,
        invoice: null,
        paymentRequest: buildCashuRequest({
          sats: Sats.make(400),
          mintUrl: mint,
          deviceNprofile: fake.nostr.nprofile,
          paymentId: cashu.id,
        }),
      });
      await deliverChat(
        payloadMessage(await customer.payload(cashu.id, 400)),
        "live",
      );
      expect(await ledger.payment(cashu.id)).toMatchObject({
        status: "paid",
        method: "cashu",
        cashuReceive: { sats: expect.any(Number) },
      });

      // A further payload for the Lightning payment pays it again, kept as a receipt.
      const lightningSats = (await ledger.payment(lightning.id))?.bitcoin?.sats;
      await deliverChat(
        payloadMessage(
          await customer.payload(lightning.id, lightningSats ?? 0),
        ),
        "live",
      );
      expect((await ledger.records()).receipts).toMatchObject([
        { method: "cashu", paymentId: lightning.id },
      ]);

      // Out over Lightning: an invoice's amount is fixed and never costs more than quoted.
      const before = await balanceOf(wallet);
      const invoice = await customer.invoiceFor(333);
      const payout = succeed(
        await withdrawals.quote({
          kind: "lightning_invoice",
          invoice: Bolt11Invoice.make(invoice),
          amountSats: 333,
        }),
      );
      expect(payout.amountSats).toBe(333);
      expect(succeed(await withdrawals.execute(payout)).status).toBe("done");
      const debit = before - (await balanceOf(wallet));
      expect(debit).toBeLessThanOrEqual(payout.totalSats);
      const [paidOut] = (await ledger.records()).withdrawals;
      expect((paidOut?.amountSats ?? 0) + (paidOut?.feeSats ?? 0)).toBe(debit);

      // Out to Linky: the whole balance leaves, fees deducted from the token.
      const linky = makeIdentity().pubkey;
      const all = succeed(
        await withdrawals.quote({
          kind: "cashu_chat",
          pubkey: linky,
          npub: "",
        }),
      );
      expect(all.totalSats).toBe(await balanceOf(wallet));
      expect(succeed(await withdrawals.execute(all)).status).toBe("pending");
      expect(sentTokens).toHaveLength(1);
      expect(await balanceOf(wallet)).toBe(0);

      const records = await ledger.records();
      const activity = walletActivity(records, Infinity);
      expect(activity.reduce((sum, item) => sum + balanceChange(item), 0)).toBe(
        0,
      );
      await payments.stop();
    },
  );

  it(
    "forwards an incoming pledge payment once when two terminals race against fragmented proofs",
    { timeout: 120_000 },
    async () => {
      // Rate where 20 CZK = 1,473 sat, matching the multi-terminal journey failure.
      const pledgeRate = 1_357_773;
      const account = testAccount();
      const pledger = makeIdentity().pubkey;

      const makeTerminal = () => {
        const store = testStore();
        const repositories = makeRepositories(store);
        const ledger = makeLedger(repositories.transactions);
        const wallet = createWallet(
          makeLinkshuRuntime({
            cashuSeed: account.cashuSeed,
            wallet: repositories.wallet,
          }),
          account.secretKey,
        );
        const sentTokens: {
          token: string;
          ref: string;
          clientId: ClientId | undefined;
        }[] = [];
        const sentTexts: { text: string; clientId: ClientId }[] = [];
        const fake = fakeNostr({
          sendToken: async (_to, token, ref, clientId) => {
            sentTokens.push({ token, ref, clientId });
            return new EnqueueReceipt({
              jobId: OutboxJobId.make(ref),
              ref: OutboxRef.make(ref),
              rumorId: RumorId.make("ef".repeat(32)),
              clientId: clientId ?? ClientId.make(ref),
              sentAt: UnixSeconds.make(1_700_000_000),
            });
          },
          sendText: async (_to, text, clientId, ref) => {
            sentTexts.push({ text, clientId });
            return new EnqueueReceipt({
              jobId: OutboxJobId.make(ref),
              ref: OutboxRef.make(ref),
              rumorId: RumorId.make("ef".repeat(32)),
              clientId,
              sentAt: UnixSeconds.make(1_700_000_000),
            });
          },
        });
        const pledges = createPledges({
          ledger,
          settings: repositories.settings,
          nostr: fake.nostr,
          wallet,
          czkPerBtc: async () => pledgeRate,
          whenHydrated: async () => {},
        });
        return {
          repositories,
          ledger,
          wallet,
          pledges,
          sentTokens,
          sentTexts,
        };
      };

      const pos1 = makeTerminal();
      const pos2 = makeTerminal();

      // Accumulate 1,923 sat pre-existing balance on pos2 and receive the 1,473 sat payment on pos1
      // (disjoint proof sets before wallet shards sync, so two non-envelope swaps both succeed).
      const topup = (wallet: Wallet, amount: number) =>
        wallet.run(
          Effect.scoped(
            Effect.flatMap(
              Effect.flatMap(Topup, (topups) =>
                topups.start(
                  new TopupDraft({ mint, amount: Amount.make(amount) }),
                ),
              ),
              (handle) => handle.result,
            ),
          ),
        );
      for (const amount of [300, 400, 500, 350, 373]) {
        succeed(await topup(pos2.wallet, amount));
      }
      succeed(await topup(pos1.wallet, 1_473));

      const opened = await pos1.pledges.open(
        { pubkey: pledger, address: null },
        CzkAmount.make(5_000),
      );
      await Effect.runPromise(savePledge(pos2.repositories.settings, opened));

      const inflow = {
        operationId: "inflow-20czk",
        sats: 1_473,
        czkPerBtc: pledgeRate,
        mintUrl: mint,
        payerPubkey: makeIdentity().pubkey,
        note: null,
      };
      await pos1.ledger.recordDirectTransfer(inflow);
      await pos2.ledger.recordDirectTransfer(inflow);

      await Promise.all([pos1.pledges.reconcile(), pos2.pledges.reconcile()]);

      // Redeem every forwarded token into a customer wallet: only one 1,473 sat payment may settle.
      const customer = setup().wallet;
      const allTokens = [
        ...pos1.sentTokens.map((entry) => entry.token),
        ...pos2.sentTokens.map((entry) => entry.token),
      ];
      expect(allTokens).toHaveLength(1);
      for (const token of allTokens) {
        await customer.receive(token);
      }
      expect(await balanceOf(customer)).toBeLessThanOrEqual(1_473);
      expect(await balanceOf(customer)).toBeGreaterThan(1_450);

      // Only the winning terminal writes the withdrawal and sends the single repayment message.
      const w1 = (await pos1.ledger.records()).withdrawals;
      const w2 = (await pos2.ledger.records()).withdrawals;
      expect(w1.length + w2.length).toBe(1);
      const repaymentTexts = [...pos1.sentTexts.slice(1), ...pos2.sentTexts];
      expect(repaymentTexts).toHaveLength(1);
      expect(repaymentTexts[0]?.text).toMatch(
        /Zbývá doplatit 30(?:,0\d)? Kč\./u,
      );

      // Combined unspent balance across both terminals preserves the 1,923 sat pre-existing funds (minus swap fee).
      const remainingBalance =
        (await balanceOf(pos1.wallet)) + (await balanceOf(pos2.wallet));
      expect(remainingBalance).toBeGreaterThanOrEqual(1_915);
      expect(remainingBalance).toBeLessThanOrEqual(1_923);

      pos1.pledges.stop();
      pos2.pledges.stop();
    },
  );
});
