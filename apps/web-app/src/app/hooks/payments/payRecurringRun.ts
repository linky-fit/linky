import type { EnvelopeState, OperationId } from "@linky-fit/linkshu";
import {
  transactionIdForOperation,
  transactionIdForQuote,
} from "@linky-fit/linksync";
import { ClientId } from "@linky-fit/linkstr";
import {
  recurringEnvelopeKey,
  recurringRunDetails,
  type RecurringRun,
  type RecurringRunAction,
} from "@linky-fit/recurring-payment";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { Either } from "effect";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { fetchLnurlInvoiceForTarget } from "../../../lnurlPay";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import type { LoggedPaymentEventParams } from "../../types/appTypes";
import type {
  CashuEnvelopeRef,
  CashuEnvelopes,
} from "../composition/useLinkshuComposition";
import type { SendTokenMessage } from "./useSendTokenMessage";

/**
 * `paid`: the envelope was delivered now, or found already spent (redeemed
 * or melted, maybe by another device), then `delivered` is false. `waiting`:
 * a melt of it is in flight, or its token message waits for a relay.
 * `busy`: another tab or device is opening, sending or melting it right
 * now; the next pass finds out how that ended. `unfunded`: the balance at
 * the mint did not cover a new envelope or the melt's fee reserve.
 * `noRecipient`: nothing went out and the contact cannot be paid. `mixed`:
 * part of it is spent, which needs the user.
 */
export type RecurringRunResult =
  | {
      kind: "paid";
      amountSat: number;
      delivered: boolean;
      operationId: OperationId | null;
    }
  | { kind: "waiting"; operationId: OperationId | null }
  | { kind: "busy" }
  | { kind: "unfunded" }
  | { kind: "noRecipient" }
  | { kind: "mixed"; operationId: OperationId | null }
  | { kind: "failed"; error: string; operationId: OperationId | null };

export interface RecurringRunDependencies {
  envelopes: CashuEnvelopes;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  sendTokenMessage: SendTokenMessage;
}

type EnvelopeRun = Pick<RecurringRun, "order" | "runIndex">;

/** One envelope per run, at the order's mint. */
export const runEnvelopeRef = (run: EnvelopeRun): CashuEnvelopeRef => ({
  mint: run.order.mintUrl,
  key: recurringEnvelopeKey(run.order.id, run.runIndex),
});

/** Whether the attempt found the run's envelope funded at the mint. */
export const foundEnvelope = (result: RecurringRunResult): boolean => {
  switch (result.kind) {
    case "busy":
    case "unfunded":
    case "noRecipient":
      return false;
    case "failed":
      return result.operationId !== null;
    default:
      return true;
  }
};

const describeError = (error: { readonly _tag: string }): string =>
  describeTaggedCashuError(error) ?? error._tag;

const failed = (
  error: string,
  operationId: OperationId | null = null,
): RecurringRunResult => ({ kind: "failed", error, operationId });

/** One mapping for every envelope call that fails. */
const errorResult = (
  error: { readonly _tag: string },
  operationId: OperationId | null,
): RecurringRunResult => {
  switch (error._tag) {
    case "EnvelopeBusy":
    case "EnvelopeNotFound":
      return { kind: "busy" };
    case "InsufficientFunds":
      return { kind: "unfunded" };
    default:
      return failed(describeError(error), operationId);
  }
};

/** What the mint's answer settles before any delivery; null while the envelope is absent or unspent. */
const settledByMint = ({
  amount,
  operationId,
  status,
}: EnvelopeState): RecurringRunResult | null => {
  switch (status) {
    case "spent":
      return { kind: "paid", amountSat: amount, delivered: false, operationId };
    case "pending":
      return { kind: "waiting", operationId };
    case "mixed":
      return { kind: "mixed", operationId };
    default:
      return null;
  }
};

// Hashed so the recipient, who sees the client id, does not learn the order id.
const runClientId = (run: RecurringRun): ClientId =>
  ClientId.make(
    bytesToHex(
      sha256(utf8ToBytes(recurringEnvelopeKey(run.order.id, run.runIndex))),
    ).slice(0, 32),
  );

const runDetails = (run: RecurringRun) =>
  recurringRunDetails({
    recurringPaymentId: run.order.id,
    dueAtSec: run.dueAtSec,
  });

/** Paid once a relay accepted the token message, not when it was queued. */
const sendToken = async (
  deps: RecurringRunDependencies,
  run: RecurringRun,
  npub: string,
): Promise<RecurringRunResult> => {
  const token = await deps.envelopes.send({
    ...runEnvelopeRef(run),
    memo: run.order.note,
  });
  if (Either.isLeft(token)) return errorResult(token.left, null);
  const { amount, operationId, tokenText } = token.right;
  const delivery = await deps.sendTokenMessage({
    amount,
    clientId: runClientId(run),
    contactId: run.order.contactId,
    contactNpub: npub,
    mint: run.order.mintUrl,
    tokenText,
  });
  if (delivery.status === "failed") return failed(delivery.error, operationId);
  if (delivery.status === "queued") return { kind: "waiting", operationId };
  deps.logPaymentEvent({
    amount,
    contactId: run.order.contactId,
    details: { issuedToken: tokenText, ...runDetails(run) },
    direction: "out",
    fee: null,
    method: "cashu_chat",
    mint: run.order.mintUrl,
    note: run.order.note,
    phase: "complete",
    status: "ok",
    transactionId: transactionIdForOperation(operationId),
    unit: "sat",
  });
  return { kind: "paid", amountSat: amount, delivered: true, operationId };
};

const meltToAddress = async (
  deps: RecurringRunDependencies,
  run: RecurringRunAction,
  lnAddress: string,
  amountSat: number,
  operationId: OperationId,
): Promise<RecurringRunResult> => {
  let invoice: string;
  try {
    invoice = (
      await fetchLnurlInvoiceForTarget(
        lnAddress,
        amountSat,
        run.order.note ?? undefined,
      )
    ).pr;
  } catch (error) {
    return failed(
      getUnknownErrorMessage(error, "invoice fetch failed"),
      operationId,
    );
  }
  const details = {
    lightningAddress: lnAddress,
    lightningInvoice: invoice,
    ...runDetails(run),
  };
  const melted = await deps.envelopes.melt({ ...runEnvelopeRef(run), invoice });
  if (Either.isLeft(melted)) {
    const error = melted.left;
    if (error._tag !== "PaymentPending") return errorResult(error, operationId);
    deps.logPaymentEvent({
      amount: error.amount,
      contactId: run.order.contactId,
      details: { ...details, meltQuoteId: error.quoteId },
      direction: "out",
      fee: null,
      method: "lightning_address",
      mint: error.mint,
      note: run.order.note,
      phase: "melt",
      status: "ok",
      transactionId: transactionIdForOperation(error.operationId),
      unit: "sat",
    });
    return { kind: "waiting", operationId };
  }
  const receipt = melted.right;
  deps.logPaymentEvent({
    amount: receipt.paidAmount,
    contactId: run.order.contactId,
    details,
    direction: "out",
    fee: receipt.feePaid,
    method: "lightning_address",
    mint: receipt.mint,
    note: run.order.note,
    phase: "complete",
    status: "ok",
    transactionId: transactionIdForQuote("melt", receipt.mint, receipt.quoteId),
    unit: "sat",
  });
  return {
    kind: "paid",
    amountSat: receipt.paidAmount,
    delivered: true,
    operationId,
  };
};

/**
 * One attempt at a run: open its envelope at the order's mint, ask the mint
 * about it, and deliver it on the order's rail while unspent. `recipient` is
 * the contact's npub on the Cashu rail, its Lightning address on the
 * Lightning rail; without one nothing is funded, the mint is only asked
 * whether the run already went out. Every step is safe to repeat from any
 * device, so a failure anywhere is retried by running this again.
 */
export const payRecurringRun = async (
  deps: RecurringRunDependencies,
  run: RecurringRunAction,
  recipient: string | null,
): Promise<RecurringRunResult> => {
  const ref = runEnvelopeRef(run);
  if (recipient === null) {
    const state = await deps.envelopes.state(ref);
    if (Either.isLeft(state)) return errorResult(state.left, null);
    return settledByMint(state.right) ?? { kind: "noRecipient" };
  }
  const opened = await deps.envelopes.open({
    ...ref,
    amountSat: run.amountSat,
  });
  if (Either.isLeft(opened)) return errorResult(opened.left, null);
  const { amount, operationId } = opened.right;
  const state = await deps.envelopes.state(ref);
  if (Either.isLeft(state)) return errorResult(state.left, operationId);
  const settled = settledByMint(state.right);
  if (settled !== null) return settled;
  if (state.right.status === "absent")
    return failed("the mint does not know the envelope", operationId);
  return run.order.rail === "cashu"
    ? sendToken(deps, run, recipient)
    : meltToAddress(deps, run, recipient, amount, operationId);
};

const releaseEnvelope = async (
  deps: RecurringRunDependencies,
  run: RecurringRun,
  state: EnvelopeState,
): Promise<boolean> => {
  const ref = runEnvelopeRef(run);
  const released = await deps.envelopes.release(ref);
  reportAppLog({
    tag: "recurring.envelopeReleased",
    summary: Either.isRight(released)
      ? "envelope of a deleted recurring payment released"
      : "envelope of a deleted recurring payment could not be released",
    links: {
      recurringPayment: run.order.id,
      ...(state.operationId === null ? {} : { operation: state.operationId }),
    },
    payload: {
      ...ref,
      ...(Either.isRight(released)
        ? { amount: released.right.amount }
        : { error: released.left._tag }),
    },
  });
  return Either.isRight(released);
};

/**
 * `settled`: nothing is left to do. `delivered`: a Cashu-rail token went to
 * the contact now. `later`: try again (a melt in flight, the mint or the
 * relays did not answer). `noRecipient`: a Cashu-rail token waits for a
 * contact this device does not know. `partlySpent`: part of a Cashu-rail
 * token was spent elsewhere, so the rest can be neither sent nor reclaimed.
 */
export type DeletedRunSettlement =
  | "settled"
  | "delivered"
  | "later"
  | "noRecipient"
  | "partlySpent";

/**
 * Settles one envelope of a deleted order, found in `state`. A
 * Lightning-rail envelope was never handed to anyone, so its unspent part
 * goes back to the balance. A Cashu-rail one may already be in the contact's
 * chat, sent by any device, so it is the contact's: its token is delivered
 * (again) instead, and never released.
 */
export const settleDeletedRun = async (
  deps: RecurringRunDependencies,
  run: RecurringRun,
  state: EnvelopeState,
  recipient: string | null,
): Promise<DeletedRunSettlement> => {
  if (run.order.rail === "lightning") {
    if (state.status === "pending") return "later";
    if (state.status !== "unspent" && state.status !== "mixed") {
      return "settled";
    }
    return (await releaseEnvelope(deps, run, state)) ? "settled" : "later";
  }
  if (state.status === "mixed") return "partlySpent";
  if (state.status !== "unspent") return "settled";
  if (recipient === null) return "noRecipient";
  const sent = await sendToken(deps, run, recipient);
  return sent.kind === "paid" ? "delivered" : "later";
};
