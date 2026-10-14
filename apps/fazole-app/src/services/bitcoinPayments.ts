import {
  Amount,
  parseMintUrl,
  Topup,
  TopupDraft,
  type TopupError,
  type TopupHandle,
  type TopupQuote,
  type TopupReceipt,
} from "@linky-fit/linkshu";
import { Effect, Exit, Result, Scope } from "effect";
import {
  buildCashuRequest,
  cashuRequestMint,
  czkToSats,
  isOpenBitcoinRequest,
  matchIncomingCashu,
  matchRepeatedCashu,
  minimumBitcoinSats,
  minimumCzkFor,
  OPEN_REQUEST_SEC,
  readIncomingCashu,
  uniqueRequestSats,
  type CzkAmount,
  type IncomingCashu,
  type Payment,
  type Sats,
} from "../domain";
import type { Ledger } from "../storage/ledger";
import { nowSeconds } from "../utils/time";
import type { InboxHandler, Nostr } from "./nostr";
import { exclusive, serialQueue } from "./serial";
import type { Wallet } from "./wallet";
import { isTransientReceiveError } from "./wallet";

/**
 * Why a payment could not get its Bitcoin leg: a missing rate or mint is
 * worth a retry, an amount below what the mint's fees allow is not.
 */
export type BitcoinRequestFailure =
  | { readonly reason: "rate-unavailable" | "mint-unreachable" }
  | { readonly reason: "below-minimum"; readonly minimumCzk: CzkAmount };

/**
 * Takes Bitcoin payments: a Lightning quote and a Cashu request per payment,
 * settled by whichever the customer pays first. Sats that arrive for a
 * payment already paid, or for none, are recorded as a receipt.
 */
export interface BitcoinPayments {
  /**
   * Gives a payment its Bitcoin leg unless it has one: the CZK amount in
   * sats at the current rate, made unique among the open requests, a NUT-20
   * locked mint quote and a NUT-18 request to this account, stored on the
   * payment. A leg whose quote expired gets a fresh one.
   */
  readonly request: (
    paymentId: string,
  ) => Promise<BitcoinRequestFailure | null>;
  /** Watches every pending quote, also after a reload; call when the store is hydrated. */
  readonly resume: () => Promise<void>;
  /** Stops watching quotes; the persisted quotes resume on the next start. */
  readonly stop: () => Promise<void>;
}

const RESUME_DELAY_MS = 30_000;

/** A payment's open Bitcoin request in the shape the matching rules take. */
interface OpenPayment {
  readonly id: string;
  readonly status: Payment["status"];
  readonly sats: Sats;
  readonly mintUrl: string;
  readonly createdAtSec: number;
  readonly payment: Payment;
}

const bitcoinRequestsWhere = (
  payments: readonly Payment[],
  isCandidate: (payment: Payment) => boolean,
): OpenPayment[] =>
  payments.flatMap((payment) => {
    const leg = payment.bitcoin;
    const mintUrl = leg === null ? null : cashuRequestMint(leg.paymentRequest);
    return leg === null || mintUrl === null || !isCandidate(payment)
      ? []
      : [{ ...payment, sats: leg.sats, mintUrl, payment }];
  });

/** Recent unpaid Bitcoin requests, also cancelled ones: a token can still pay each. */
export const openBitcoinPayments = (
  payments: readonly Payment[],
  nowSec = nowSeconds(),
) =>
  bitcoinRequestsWhere(payments, (payment) =>
    isOpenBitcoinRequest(payment, nowSec),
  );

/** Recent paid Bitcoin requests, which a customer may pay a second time. */
export const paidBitcoinPayments = (
  payments: readonly Payment[],
  nowSec = nowSeconds(),
) =>
  bitcoinRequestsWhere(
    payments,
    (payment) =>
      payment.status === "paid" &&
      nowSec - payment.createdAtSec < OPEN_REQUEST_SEC,
  );

export const createBitcoinPayments = ({
  ledger,
  nostr,
  wallet,
  czkPerBtc,
  mintUrl,
  shopName,
  whenHydrated,
}: {
  readonly ledger: Ledger;
  readonly nostr: Nostr;
  readonly wallet: Wallet;
  readonly czkPerBtc: () => Promise<number | null>;
  /** The mint new requests are payable at. */
  readonly mintUrl: string;
  /** The invoice description, where the mint allows one. */
  readonly shopName: () => Promise<string | null>;
  /** Resolves once background writes may run. */
  readonly whenHydrated: () => Promise<void>;
}): BitcoinPayments => {
  const { runtime, lockingKey } = wallet;
  // Topup polling runs in this scope; closing it stops every poll, and the
  // persisted quotes resume in the next scope.
  let scope = Effect.runSync(Scope.make());
  const serially = serialQueue("bitcoin payments");
  // Settling one leg reads what the other one wrote.
  const settling = exclusive();

  const paymentWithQuote = async (quoteId: string) =>
    (await ledger.records()).payments.find(
      (payment) => payment.bitcoin?.quoteId === quoteId,
    ) ?? null;

  /** Pays the quote's payment, or records the minted sats when another leg paid it first or no payment asks for them. */
  const recordMinted = async (minted: TopupReceipt) => {
    const payment = await paymentWithQuote(minted.quoteId);
    if (payment && (await ledger.completePayment(payment, "lightning"))) return;
    // This quote paid it in an earlier session.
    if (payment?.status === "paid" && payment.method === "lightning") return;
    await ledger.recordReceipt({
      operationId: minted.operationId,
      method: "lightning",
      sats: minted.amount,
      paymentId: payment?.id ?? null,
    });
  };

  const settleTopup = async (
    quote: TopupQuote,
    outcome: Result.Result<TopupReceipt, TopupError>,
  ) => {
    await whenHydrated();
    if (Result.isSuccess(outcome)) {
      await settling(() => recordMinted(outcome.success));
      return;
    }
    switch (outcome.failure._tag) {
      case "QuoteExpired": {
        const payment = await paymentWithQuote(quote.quoteId);
        if (payment?.status === "pending") {
          await ledger.clearLightningQuote(payment);
        }
        return;
      }
      case "MintUnreachable":
      case "CounterLockTimeout":
        scheduleResume();
        return;
      case "MintRejected":
        console.warn("[fazole] mint rejected a payment quote", outcome.failure);
        return;
    }
  };

  const watch = (handle: TopupHandle) => {
    runtime.runPromise(Effect.result(handle.result)).then(
      (outcome) => settleTopup(handle.quote, outcome),
      // Interrupted by a resume or a stop; the next resume watches the quote again.
      () => undefined,
    );
  };

  const resume = () =>
    serially(async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      scope = Effect.runSync(Scope.make());
      const handles = await runtime.runPromise(
        Scope.provide(
          Effect.flatMap(Topup, (topup) => topup.resumePending({ lockingKey })),
          scope,
        ),
      );
      handles.forEach(watch);
    }).then(() => undefined);

  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleResume = () => {
    if (resumeTimer !== null) return;
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      void resume();
    }, RESUME_DELAY_MS);
  };

  const startRequest = async (
    paymentId: string,
  ): Promise<BitcoinRequestFailure | null> => {
    // The caller's row may predate a request that just landed.
    const payment = await ledger.payment(paymentId);
    if (payment === null || payment.bitcoin?.quoteId) return null;
    const rate = await czkPerBtc();
    if (rate === null) return { reason: "rate-unavailable" };
    const mint = parseMintUrl(mintUrl);
    if (mint === null) return { reason: "mint-unreachable" };
    const priced = czkToSats(payment.amountCzk, rate);
    const minimum = minimumBitcoinSats(await wallet.inputFeePpk(mint));
    if (priced < minimum) {
      return {
        reason: "below-minimum",
        minimumCzk: minimumCzkFor(minimum, rate),
      };
    }
    const description = await shopName();
    // Serial, so two requests created at once never pick the same amount.
    const started = await serially(async () => {
      const sats = uniqueRequestSats(
        priced,
        openBitcoinPayments((await ledger.records()).payments).filter(
          ({ id }) => id !== payment.id,
        ),
      );
      const topup = await runtime.runPromise(
        Effect.result(
          Scope.provide(
            Effect.flatMap(Topup, (topups) =>
              topups.start(
                new TopupDraft({
                  mint,
                  amount: Amount.make(sats),
                  ...(description ? { description } : {}),
                }),
                { lockingKey },
              ),
            ),
            scope,
          ),
        ),
      );
      if (Result.isFailure(topup)) return topup;
      const { quote } = topup.success;
      await ledger.attachBitcoinLeg(payment, {
        sats,
        czkPerBtc: rate,
        mintUrl: mint,
        quoteId: quote.quoteId,
        invoice: quote.invoice,
        paymentRequest: buildCashuRequest({
          sats,
          mintUrl: mint,
          deviceNprofile: nostr.nprofile,
          paymentId: payment.id,
        }),
      });
      return topup;
    });
    if (started === undefined) return { reason: "mint-unreachable" };
    if (Result.isFailure(started)) {
      console.warn("[fazole] payment quote failed", started.failure._tag);
      return { reason: "mint-unreachable" };
    }
    watch(started.success);
    return null;
  };

  const requests = new Map<string, Promise<BitcoinRequestFailure | null>>();

  /** Receives the text; the receive holding its sats, `null` when they are not there or already recorded. */
  const unrecordedReceiveOf = async (
    text: string,
    incoming: IncomingCashu,
  ): Promise<{
    readonly operationId: string;
    readonly sats: number;
  } | null> => {
    const received = await wallet.receive(text);
    if (Result.isSuccess(received)) {
      return {
        operationId: received.success.operationId,
        sats: received.success.amount,
      };
    }
    // Unacknowledged, so the next session receives it again.
    if (isTransientReceiveError(received.failure)) throw received.failure;
    if (received.failure._tag !== "TokenAlreadyKnown") return null;
    // A replay, such as after a reload between receiving and recording; its net amount is gone, so the face value stands in.
    const { operationId } = received.failure;
    return operationId !== null &&
      !(await ledger.hasReceipt(operationId)) &&
      (await wallet.isReceived(operationId))
      ? { operationId, sats: incoming.amount }
      : null;
  };

  /**
   * Receives a token and records what it put into the wallet: it pays the
   * payment it matches, also a cancelled one; a token for a paid payment is
   * recorded as paying it again, and one that matches none as a receipt.
   */
  const receiveChatToken: InboxHandler = async (event) => {
    if (event._tag !== "ChatMessageReceived" || event.editOf !== null) return;
    const text =
      event.body._tag === "TokenBody"
        ? event.body.token
        : event.body._tag === "TextBody"
          ? event.body.text
          : null;
    const incoming = text === null ? null : readIncomingCashu(text);
    if (text === null || incoming === null) return;
    await whenHydrated();
    const received = await unrecordedReceiveOf(text, incoming);
    if (received === null) return;
    await settling(async () => {
      const { payments } = await ledger.records();
      const paidBefore = payments.find(
        (payment) => payment.cashuReceive?.operationId === received.operationId,
      );
      if (paidBefore) return;
      const open = matchIncomingCashu(incoming, openBitcoinPayments(payments));
      if (
        open &&
        (await ledger.completePayment(open.payment, {
          cashuReceive: received,
          payerPubkey: event.from,
        }))
      ) {
        return;
      }
      const repeated = matchRepeatedCashu(
        incoming,
        paidBitcoinPayments(payments),
      );
      await ledger.recordReceipt({
        operationId: received.operationId,
        method: "cashu",
        sats: received.sats,
        paymentId: repeated?.payment.id ?? null,
      });
    });
  };

  nostr.onInboxEvent(receiveChatToken);

  return {
    request: (paymentId) => {
      const inflight = requests.get(paymentId);
      if (inflight) return inflight;
      const request = startRequest(paymentId).finally(() =>
        requests.delete(paymentId),
      );
      requests.set(paymentId, request);
      return request;
    },
    resume,
    stop: async () => {
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = null;
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
};
