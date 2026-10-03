import { extractTokenText, parseTokenText } from "@linky-fit/linkshu";
import type { MintUrl } from "@linky-fit/linkshu";
import { UnixSeconds } from "@linky-fit/linkstr";
import type {
  Pubkey,
  RumorId,
  SupporterAwardEvents,
  SupporterRefusalReason,
  SupporterResult,
} from "@linky-fit/linkstr";
import { supporterTierForAmount } from "@linky-fit/supporter";
import type { SupporterTier } from "@linky-fit/supporter";
import { createHash } from "node:crypto";
import { logInfo, logWarn, shortPubkey } from "./log";
import { Payment, TokenHash } from "./storage";
import type { PaymentStore } from "./storage";

export interface TokenMessage {
  readonly from: Pubkey;
  readonly rumorId: RumorId;
  readonly token: string;
}

/**
 * `received`: the wallet holds the token, now or from an earlier receive;
 * `deferred`: its mint is down, the wallet keeps it for `resumeDeferred`;
 * `retry`: a transient failure, receive the token again later;
 * `spent`: someone else received it; `invalid`: it is not a usable token.
 */
export type ReceiveOutcome =
  | "received"
  | "deferred"
  | "retry"
  | "spent"
  | "invalid";

export interface SupporterWallet {
  readonly receive: (tokenText: string) => Promise<ReceiveOutcome>;
  /** Retries deferred receives; returns the tokens whose mint is still down. */
  readonly resumeDeferred: () => Promise<ReadonlySet<TokenHash>>;
  /** The text of a token the wallet recorded, so a crashed payment can resume. */
  readonly findTokenText: (tokenHash: TokenHash) => Promise<string | null>;
}

export interface ResultDelivery {
  readonly to: Pubkey;
  /** The token message the result answers. */
  readonly tokenMessageId: RumorId;
  readonly tokenHash: TokenHash;
  readonly result: SupporterResult;
}

export interface SupporterMessenger {
  /** Signs the tiered and the generic award, in that order. */
  readonly signAwards: (
    supporter: Pubkey,
    tier: SupporterTier,
    awardedAt: UnixSeconds,
  ) => Promise<SupporterAwardEvents>;
  /**
   * Resolves once the result is queued in the durable outbox; a result
   * already queued for the token is not queued again.
   */
  readonly sendResult: (delivery: ResultDelivery) => Promise<void>;
}

export interface PaymentPipelineDeps {
  readonly payments: PaymentStore;
  readonly wallet: SupporterWallet;
  readonly messenger: SupporterMessenger;
  readonly acceptedMints: ReadonlyArray<MintUrl>;
  readonly nowMs?: () => number;
}

export const tokenHashOf = (tokenText: string): TokenHash =>
  TokenHash.make(
    createHash("sha256")
      .update(extractTokenText(tokenText) ?? tokenText.trim())
      .digest("hex"),
  );

const refused = (reason: SupporterRefusalReason): SupporterResult => ({
  status: "refused",
  reason,
});

const describe = (payment: Payment): string =>
  `payment=${payment.tokenHash.slice(0, 12)} from=${shortPubkey(payment.sender)}`;

export const createPaymentPipeline = (deps: PaymentPipelineDeps) => {
  const now = deps.nowMs ?? Date.now;
  const acceptedMints = new Set(deps.acceptedMints);

  // Inbox arrivals and the retry timer take turns, so one token is never
  // received or answered twice at once.
  let turn: Promise<void> = Promise.resolve();
  const serialized = (run: () => Promise<void>): Promise<void> => {
    const next = turn.then(run);
    turn = next.catch(() => undefined);
    return next;
  };

  const deliver = async (payment: Payment, result: SupporterResult) => {
    await deps.messenger.sendResult({
      to: payment.sender,
      tokenMessageId: payment.rumorId,
      tokenHash: payment.tokenHash,
      result,
    });
    logInfo(`${describe(payment)} result queued status=${result.status}`);
  };

  const conclude = async (payment: Payment, result: SupporterResult) => {
    deps.payments.updatePayment(
      payment.tokenHash,
      { state: "ready", result },
      now(),
    );
    await deliver(payment, result);
  };

  const receivedResult = async (payment: Payment): Promise<SupporterResult> => {
    if (payment.tier === null) return { status: "thanks" };
    const awardedAt = UnixSeconds.make(Math.floor(now() / 1000));
    const awards = await deps.messenger.signAwards(
      payment.sender,
      payment.tier,
      awardedAt,
    );
    return { status: "issued", tier: payment.tier, awards };
  };

  const settle = async (payment: Payment, tokenText: string) => {
    const outcome = await deps.wallet.receive(tokenText);
    logInfo(`${describe(payment)} receive=${outcome}`);
    switch (outcome) {
      case "received":
        return conclude(payment, await receivedResult(payment));
      case "spent":
        return conclude(payment, refused("token_spent"));
      case "invalid":
        return conclude(payment, refused("invalid_token"));
      case "deferred":
        return deps.payments.updatePayment(
          payment.tokenHash,
          { state: "deferred" },
          now(),
        );
      case "retry":
        return;
    }
  };

  const refusalOf = (token: string): SupporterRefusalReason | null => {
    const parsed = parseTokenText(token);
    if (parsed === null || parsed.mint === null) return "invalid_token";
    if ((parsed.unit ?? "sat") !== "sat") return "invalid_token";
    return acceptedMints.has(parsed.mint) ? null : "mint_not_accepted";
  };

  const handleToken = (message: TokenMessage): Promise<void> =>
    serialized(async () => {
      const tokenHash = tokenHashOf(message.token);
      const known = deps.payments.findPayment(tokenHash);
      if (known !== null) {
        if (known.result === null) return settle(known, message.token);
        if (known.state === "ready") return deliver(known, known.result);
        return;
      }

      const refusal = refusalOf(message.token);
      const amount = parseTokenText(message.token)?.amount ?? null;
      const payment = new Payment({
        tokenHash,
        sender: message.from,
        rumorId: message.rumorId,
        amount,
        tier:
          refusal === null && amount !== null
            ? supporterTierForAmount(amount)
            : null,
        state: "receiving",
        result: null,
        createdAt: now(),
        updatedAt: now(),
      });
      deps.payments.insertPayment(payment);
      logInfo(`${describe(payment)} recorded amount=${amount ?? "?"}`);
      return refusal === null
        ? settle(payment, message.token)
        : conclude(payment, refused(refusal));
    });

  /** Finishes deferred receives, crashed payments and undelivered results. */
  const retryUnfinished = (): Promise<void> =>
    serialized(async () => {
      const unfinished = deps.payments.unfinishedPayments();
      const stillDeferred = unfinished.some(
        (payment) => payment.state === "deferred",
      )
        ? await deps.wallet.resumeDeferred()
        : new Set<TokenHash>();
      for (const payment of unfinished) {
        try {
          if (payment.result !== null) {
            await deliver(payment, payment.result);
            continue;
          }
          if (stillDeferred.has(payment.tokenHash)) continue;
          const tokenText = await deps.wallet.findTokenText(payment.tokenHash);
          // Not recorded by the wallet yet: the inbox replays the message.
          if (tokenText !== null) await settle(payment, tokenText);
        } catch (error) {
          logWarn(`${describe(payment)} retry failed`, error);
        }
      }
    });

  /** The outbox reports that a relay accepted the payment's result. */
  const confirmDelivered = (tokenHash: TokenHash): Promise<void> =>
    serialized(async () => {
      const payment = deps.payments.findPayment(tokenHash);
      if (payment?.state !== "ready") return;
      deps.payments.updatePayment(tokenHash, { state: "delivered" }, now());
      logInfo(`${describe(payment)} result delivered`);
    });

  return { handleToken, retryUnfinished, confirmDelivered };
};

export type PaymentPipeline = ReturnType<typeof createPaymentPipeline>;
