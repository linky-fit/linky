import {
  ContactId,
  transactionIdForOperation,
  transactionIdForQuote,
} from "@linky-fit/linksync";
import {
  buildPaymentAmountAttempts,
  buildPaymentFailureAmountAttempts,
  getLightningInvoicePreview,
  isAllowedPaymentRequestPostUrl,
  isRetryablePaymentAmountFailure,
  mintMoveCovers,
  planSendMint,
  postPaymentRequestPayload,
  type MeltReceipt,
  type MintUrl,
  type PaymentPending,
  type PostPaymentRequestPayloadOutcome,
  type SendReceipt,
  type WalletBalances,
} from "@linky-fit/linkshu";
import {
  decodeNpub,
  type PaymentNoticeContext,
  type Pubkey,
} from "@linky-fit/linkstr";
import { Option, Result } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import {
  fetchLnurlInvoiceForTarget,
  inferLightningAddressFromLnurlTarget,
  type LnurlPaySuccessAction,
} from "../../../lnurlPay";
import { normalizeMintUrl } from "../../../utils/mint";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { makeLocalId } from "../../../utils/validation";
import { nowSeconds } from "../../../utils/time";
import type { ReplyContext } from "../../hooks/messages/useSendChatMessage";
import { publishCashuMessagePayment } from "../../hooks/payments/publishCashuMessagePayment";
import type { CashuMessagePaymentHookResult } from "../../hooks/payments/cashuMessagePaymentTypes";
import { reportCashuSendForgotten } from "../../lib/cashuSendInspector";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { isSpellingOf } from "../../lib/mintSpelling";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import { visibleWalletBalances } from "../../lib/testMintGate";
import type {
  AppendLocalNostrMessage,
  ContactPayRowLike,
  ContactRowLike,
  LocalNostrMessage,
  PaymentTelemetryMethod,
  PaymentTelemetryPaymentType,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import { linkshuCommandsAtom, type LinkshuCommands } from "../linkshu/commands";
import {
  linkstrCommands,
  type LinkstrCommands,
} from "@linky-fit/linkstr-react";
import { platformAtom } from "../platform";
import { allowTestMintsAtom } from "../session/settings";
import { currentNpubAtom, currentNsecAtom } from "../session/session";
import { defaultMintAtom } from "./defaultMint";
import { planDefaultMintMove } from "./moveFunds";
import { walletOpsAtom, type WalletOps } from "./opQueue";
import { logPayStep, paymentLogAtom, type PaymentLog } from "./paymentLog";

/** Whether the wallet can pay an amount from one mint. */
export type FundsCheck =
  | { readonly _tag: "Covered" }
  | { readonly _tag: "Insufficient" }
  /** Only a move into the default mint makes one mint cover it; the user confirms it first. */
  | {
      readonly _tag: "NeedsMintMove";
      readonly fromMint: MintUrl;
      readonly toMint: MintUrl;
    };

type Shortfall = Exclude<FundsCheck, { readonly _tag: "Covered" }>;
interface Busy {
  readonly _tag: "Busy";
}
interface Failed {
  readonly _tag: "Failed";
  readonly detail: string;
}
interface Invalid {
  readonly _tag: "Invalid";
}

export type PayInvoiceOutcome =
  | { readonly _tag: "Paid"; readonly receipt: MeltReceipt }
  /** The mint took the melt but has not settled it; recovery finishes it. */
  | { readonly _tag: "Pending"; readonly pending: PaymentPending }
  | Shortfall
  | Busy
  | Failed
  | Invalid;

export type PayLightningAddressOutcome =
  | {
      readonly _tag: "Paid";
      readonly receipt: MeltReceipt;
      readonly lightningAddress: string | null;
      readonly successAction: LnurlPaySuccessAction | null;
    }
  | { readonly _tag: "Pending"; readonly pending: PaymentPending }
  | { readonly _tag: "InvalidAmount" }
  | Shortfall
  | Busy
  | Failed
  | Invalid;

export interface ContactPayment {
  readonly amountSat: number;
  readonly contact: ContactRowLike;
  /** A retry of a payment queued offline; only logged differently. */
  readonly fromQueue?: boolean;
  /** Records only the completed payment, not failed steps. */
  readonly logCompletedOnly?: boolean;
  /** Travels as the token's memo and is kept as the transaction note. */
  readonly memo?: string | null;
  readonly paymentNoticeContext?: PaymentNoticeContext;
  readonly paymentNoticeOfferId?: string;
  readonly paymentRequestId?: string | null;
  /** Checked before the token is made and again before it is sent. */
  readonly isPaymentAuthorized?: () => boolean;
  readonly pendingMessageId?: string;
  readonly replyContext?: ReplyContext | null;
  /** The localized chat placeholder an offline payment leaves until it is sent. */
  readonly offlineNotice: string;
}

/** The chat's local message writes, owned by the messaging hooks. */
export interface ChatWrites {
  readonly appendLocalNostrMessage: AppendLocalNostrMessage;
  readonly updateLocalNostrMessage: UpdateLocalNostrMessage;
  readonly nostrMessagesLocal: readonly LocalNostrMessage[];
  readonly enqueuePendingPayment: (payload: {
    amountSat: number;
    contactId: ContactId;
    recipientPubkey: Pubkey;
    messageId?: string;
  }) => void;
}

export type PayContactOutcome =
  | {
      readonly _tag: "Sent";
      readonly receipt: SendReceipt;
      readonly contactId: ContactId;
      /** The token message is stored but no relay took it yet. */
      readonly queued: boolean;
      readonly publishErrors: ReadonlyArray<string>;
    }
  | { readonly _tag: "QueuedOffline"; readonly contactId: ContactId }
  | { readonly _tag: "AuthorizationChanged" }
  | { readonly _tag: "MissingIdentity" }
  | { readonly _tag: "MissingContactNpub" }
  | { readonly _tag: "InvalidContact" }
  | { readonly _tag: "Insufficient" }
  /** The offline placeholder could not be stored; nothing was queued. */
  | { readonly _tag: "NotStored"; readonly detail: string }
  | {
      readonly _tag: "Failed";
      readonly detail: string;
      readonly insufficient: boolean;
    }
  | Busy;

export type PayRequestByPostOutcome =
  | { readonly _tag: "NoPostTransport" }
  | { readonly _tag: "InvalidUrl" }
  | { readonly _tag: "InsecureTransport" }
  | { readonly _tag: "Insufficient" }
  | {
      readonly _tag: "Paid";
      readonly receipt: SendReceipt;
      readonly postUrl: URL;
    }
  | {
      readonly _tag: "Failed";
      readonly detail: string;
      readonly insufficient: boolean;
    }
  | Busy;

interface SendingOptions {
  /** Runs once the payment leaves the wallet's checks, before any mint call. */
  readonly onSending?: () => void;
}

export interface PaymentsCommands {
  readonly fundsFor: (
    amountSat: number,
    options?: { readonly acceptedMints?: ReadonlyArray<string> },
  ) => Promise<FundsCheck>;
  readonly payLightningInvoice: (
    invoice: string,
    options?: SendingOptions,
  ) => Promise<PayInvoiceOutcome>;
  readonly payLightningAddress: (
    args: {
      readonly lnAddress: string;
      readonly amountSat: number;
      readonly contact: ContactPayRowLike | null;
      readonly comment?: string | null;
    },
    options?: SendingOptions,
  ) => Promise<PayLightningAddressOutcome>;
  readonly payContact: (
    payment: ContactPayment,
    chat: ChatWrites,
    options?: SendingOptions,
  ) => Promise<PayContactOutcome>;
  /** NUT-18 POST transport; plain http only in development builds. */
  readonly payCashuPaymentRequestByPost: (
    request: CashuPaymentRequestMessageInfo,
  ) => Promise<PayRequestByPostOutcome>;
}

export interface PaymentsDeps {
  /** Accepts plain-http payment request POST targets (development builds). */
  readonly allowHttpPost: boolean;
  readonly allowTestMints: boolean;
  readonly defaultMint: string | null;
  readonly currentNpub: string | null;
  readonly currentNsec: string | null;
  readonly isOnline: () => boolean;
  readonly linkshu: Pick<
    LinkshuCommands,
    | "cashuTransferLifecycle"
    | "meltCashuInvoice"
    | "readWalletBalances"
    | "sendCashuToken"
  >;
  readonly linkstr: Pick<
    LinkstrCommands,
    "enqueueOutbox" | "sendPaymentNotice"
  >;
  readonly logPaymentEvent: PaymentLog["logPaymentEvent"];
  readonly ops: Pick<WalletOps, "runExclusiveTask">;
}

const BUSY: Busy = { _tag: "Busy" };

const describeError = (error: unknown): string =>
  describeTaggedCashuError(error) ?? getUnknownErrorMessage(error, "unknown");

const describePostFailure = (
  outcome: Exclude<PostPaymentRequestPayloadOutcome, { _tag: "Delivered" }>,
): string => {
  switch (outcome._tag) {
    case "HttpError":
      return `Payment request POST ${outcome.status}`;
    case "NetworkError":
      return outcome.detail;
    case "InsecureUrl":
      return "Payment request POST url is not https";
  }
};

/** The hook result the offline payment queue retries or drops on. */
export const paymentResultOf = (
  outcome: PayContactOutcome,
): CashuMessagePaymentHookResult => {
  switch (outcome._tag) {
    case "Sent":
      return { ok: true, queued: outcome.queued };
    case "QueuedOffline":
      return { ok: true, queued: true };
    case "AuthorizationChanged":
      return {
        error: "payment authorization changed",
        ok: false,
        queued: false,
      };
    case "MissingIdentity":
      return {
        error: "missing nsec",
        ok: false,
        queued: false,
        retryable: true,
      };
    case "MissingContactNpub":
      return { error: "missing contact npub", ok: false, queued: false };
    case "InvalidContact":
      return { error: "invalid contact id", ok: false, queued: false };
    case "Insufficient":
      return {
        error: "insufficient",
        ok: false,
        queued: false,
        retryable: true,
      };
    case "NotStored":
      return {
        error: outcome.detail,
        ok: false,
        queued: false,
        retryable: true,
      };
    case "Busy":
      return {
        error: "wallet busy",
        ok: false,
        queued: false,
        retryable: true,
      };
    case "Failed":
      return { error: outcome.detail, ok: false, queued: false };
  }
};

export const makePaymentsCommands = (deps: PaymentsDeps): PaymentsCommands => {
  const { linkshu, logPaymentEvent, ops } = deps;

  const balances = async (): Promise<WalletBalances> =>
    visibleWalletBalances(
      await linkshu.readWalletBalances(),
      deps.allowTestMints,
    );

  const shortfall = (current: WalletBalances, amountSat: number): Shortfall => {
    const plan = planDefaultMintMove(current.perMint, deps.defaultMint);
    return plan !== null &&
      mintMoveCovers({ plan, amount: amountSat, spendable: current.spendable })
      ? { _tag: "NeedsMintMove", fromMint: plan.fromMint, toMint: plan.toMint }
      : { _tag: "Insufficient" };
  };

  const sendMint = (current: WalletBalances, amountSat: number) =>
    planSendMint({
      balances: current.perMint,
      isPreferredMint: isSpellingOf(deps.defaultMint),
      amount: amountSat,
    });

  const melt = async (
    invoice: string,
    mint: MintUrl,
  ): Promise<
    Result.Result<
      MeltReceipt,
      { detail: string; pending: PaymentPending | null }
    >
  > => {
    try {
      const outcome = await linkshu.meltCashuInvoice({ invoice, mint });
      if (Result.isSuccess(outcome)) return Result.succeed(outcome.success);
      return Result.fail({
        detail: describeError(outcome.failure),
        pending:
          outcome.failure._tag === "PaymentPending" ? outcome.failure : null,
      });
    } catch (error) {
      return Result.fail({ detail: describeError(error), pending: null });
    }
  };

  const logPendingMelt = (
    pending: PaymentPending,
    method: PaymentTelemetryMethod,
    paymentType: PaymentTelemetryPaymentType,
    details: Record<string, string | null>,
    contactId: string | null,
    note: string | null,
  ) =>
    logPaymentEvent({
      direction: "out",
      status: "ok",
      transactionId: transactionIdForOperation(pending.operationId),
      amount: pending.amount,
      details: { ...details, meltQuoteId: pending.quoteId },
      fee: null,
      mint: pending.mint,
      note,
      unit: "sat",
      error: null,
      contactId,
      method,
      paymentType,
      phase: "melt",
    });

  const fundsFor: PaymentsCommands["fundsFor"] = async (amountSat, options) => {
    const current = await balances();
    if (amountSat <= current.spendable) return { _tag: "Covered" };
    const accepted = (options?.acceptedMints ?? []).flatMap((mint) => {
      const normalized = normalizeMintUrl(mint);
      return normalized ? [normalized] : [];
    });
    const check = shortfall(current, amountSat);
    // A request naming its mints only accepts the move when the default mint is one of them.
    return check._tag === "NeedsMintMove" &&
      accepted.length > 0 &&
      !accepted.includes(check.toMint)
      ? { _tag: "Insufficient" }
      : check;
  };

  const payLightningInvoice: PaymentsCommands["payLightningInvoice"] = async (
    invoice,
    options,
  ) => {
    const normalized = invoice.trim();
    if (!normalized) return { _tag: "Invalid" };
    const preview = getLightningInvoicePreview(normalized);
    const amountSat = preview?.amountSat ?? null;
    const current = await balances();
    if (amountSat !== null && amountSat > current.spendable)
      return shortfall(current, amountSat);
    if (current.spendable <= 0) return { _tag: "Insufficient" };

    const paid = await ops.runExclusiveTask(
      async (): Promise<PayInvoiceOutcome> => {
        // An amountless invoice cannot pre-select by size; any funded mint
        // may quote it, so fall back to the 1-sat threshold.
        const mint = sendMint(current, amountSat ?? 1);
        if (mint === null) return { _tag: "Insufficient" };
        options?.onSending?.();
        const details = { lightningInvoice: normalized };
        const note = preview?.description ?? null;
        const outcome = await melt(normalized, mint);
        if (Result.isFailure(outcome)) {
          const { detail, pending } = outcome.failure;
          if (pending !== null) {
            logPendingMelt(
              pending,
              "lightning_invoice",
              "lightning",
              details,
              null,
              note,
            );
            return { _tag: "Pending", pending };
          }
          logPaymentEvent({
            direction: "out",
            status: "error",
            amount: null,
            details,
            fee: null,
            mint,
            unit: "sat",
            error: detail,
            contactId: null,
            method: "lightning_invoice",
            paymentType: "lightning",
            phase: "melt",
          });
          return { _tag: "Failed", detail };
        }
        const receipt = outcome.success;
        logPaymentEvent({
          direction: "out",
          status: "ok",
          transactionId: transactionIdForQuote(
            "melt",
            receipt.mint,
            receipt.quoteId,
          ),
          amount: receipt.paidAmount,
          details,
          fee: receipt.feePaid,
          mint: receipt.mint,
          note,
          unit: "sat",
          error: null,
          contactId: null,
          method: "lightning_invoice",
          paymentType: "lightning",
          phase: "complete",
        });
        return { _tag: "Paid", receipt };
      },
    );
    return Option.getOrElse(paid, () => BUSY);
  };

  const payLightningAddress: PaymentsCommands["payLightningAddress"] = async (
    { lnAddress, amountSat, contact, comment },
    options,
  ) => {
    const paymentTarget = lnAddress.trim();
    // The LUD-12 comment is the note; an invoice description stands in
    // when there is none.
    const commentNote = (comment ?? "").trim() || null;
    const paymentType: PaymentTelemetryPaymentType = contact
      ? "contact"
      : "lightning";
    const current = await balances();
    if (amountSat > current.spendable) return shortfall(current, amountSat);
    if (!paymentTarget) return { _tag: "Invalid" };
    if (!Number.isFinite(amountSat) || amountSat <= 0)
      return { _tag: "InvalidAmount" };
    if (current.spendable <= 0) return { _tag: "Invalid" };

    const paid = await ops.runExclusiveTask(
      async (): Promise<PayLightningAddressOutcome> => {
        let resolvedLightningAddress =
          inferLightningAddressFromLnurlTarget(paymentTarget);
        const mint = sendMint(current, amountSat);
        if (mint === null) return { _tag: "Insufficient" };
        const mintBalance =
          current.perMint.find((entry) => entry.mint === mint)?.amount ?? 0;
        options?.onSending?.();

        // Paying the full balance leaves no headroom for fees; the ladder
        // degrades the requested LNURL amount until amount + fees fit.
        const attempts = buildPaymentAmountAttempts(amountSat, mintBalance);
        const seenAttempts = new Set(attempts);
        let finalError: string | null = null;
        let finalErrorMint: string | null = null;
        let lastInvoice: string | null = null;

        for (let index = 0; index < attempts.length; index += 1) {
          const attemptedAmount = attempts[index];
          const canRetryLower = (errorMessage: string): boolean => {
            if (!isRetryablePaymentAmountFailure(errorMessage)) return false;
            for (const retryAmount of buildPaymentFailureAmountAttempts(
              attemptedAmount,
              errorMessage,
            )) {
              if (seenAttempts.has(retryAmount)) continue;
              seenAttempts.add(retryAmount);
              attempts.push(retryAmount);
            }
            return index < attempts.length - 1;
          };

          let invoice: string;
          let successAction: LnurlPaySuccessAction | null;
          try {
            const fetched = await fetchLnurlInvoiceForTarget(
              paymentTarget,
              attemptedAmount,
              commentNote ?? undefined,
            );
            if (fetched.lightningAddress)
              resolvedLightningAddress = fetched.lightningAddress;
            invoice = fetched.pr;
            successAction = fetched.successAction;
            lastInvoice = invoice;
          } catch (error) {
            const errorMessage = getUnknownErrorMessage(error, "unknown");
            if (canRetryLower(errorMessage)) continue;
            finalError = errorMessage;
            finalErrorMint = null;
            break;
          }
          const note =
            commentNote ??
            getLightningInvoicePreview(invoice)?.description ??
            null;

          const outcome = await melt(invoice, mint);
          if (Result.isFailure(outcome)) {
            const { detail, pending } = outcome.failure;
            if (pending !== null) {
              logPendingMelt(
                pending,
                "lightning_address",
                paymentType,
                {
                  lightningAddress: resolvedLightningAddress,
                  lightningInvoice: invoice,
                },
                contact?.id ?? null,
                note,
              );
              return { _tag: "Pending", pending };
            }
            if (canRetryLower(detail)) continue;
            finalError = detail;
            finalErrorMint = mint;
            break;
          }

          const receipt = outcome.success;
          logPaymentEvent({
            direction: "out",
            status: "ok",
            transactionId: transactionIdForQuote(
              "melt",
              receipt.mint,
              receipt.quoteId,
            ),
            amount: receipt.paidAmount,
            details: {
              lightningAddress: resolvedLightningAddress,
              lightningInvoice: invoice,
              ...(successAction?.tag === "message"
                ? { lnurlSuccessMessage: successAction.message }
                : {}),
              ...(successAction?.tag === "url"
                ? {
                    lnurlSuccessUrl: successAction.url,
                    ...(successAction.description
                      ? {
                          lnurlSuccessUrlDescription: successAction.description,
                        }
                      : {}),
                  }
                : {}),
            },
            fee: receipt.feePaid,
            mint: receipt.mint,
            note,
            unit: "sat",
            error: null,
            contactId: contact?.id ?? null,
            method: "lightning_address",
            paymentType,
            phase: "complete",
          });
          return {
            _tag: "Paid",
            receipt,
            lightningAddress: resolvedLightningAddress,
            successAction,
          };
        }

        const detail = finalError ?? "unknown";
        logPaymentEvent({
          direction: "out",
          status: "error",
          amount: amountSat,
          details: {
            lightningAddress: resolvedLightningAddress,
            ...(lastInvoice ? { lightningInvoice: lastInvoice } : {}),
          },
          fee: null,
          mint: finalErrorMint,
          unit: "sat",
          error: detail,
          contactId: contact?.id ?? null,
          method: "lightning_address",
          paymentType,
          phase: finalErrorMint ? "melt" : "invoice_fetch",
        });
        return { _tag: "Failed", detail };
      },
    );
    return Option.getOrElse(paid, () => BUSY);
  };

  const payContactNow = async (
    payment: ContactPayment,
    chat: ChatWrites,
    options: SendingOptions | undefined,
  ): Promise<PayContactOutcome> => {
    const {
      amountSat,
      contact,
      fromQueue,
      logCompletedOnly = false,
      memo,
      paymentNoticeContext,
      paymentNoticeOfferId,
      paymentRequestId,
      isPaymentAuthorized,
      pendingMessageId,
      replyContext,
    } = payment;
    const note = (memo ?? "").trim() || null;
    // Settling a bank offer is the sats leg of a proxy payment; a request
    // id means the contact asked for this payment.
    const paymentType: PaymentTelemetryPaymentType =
      paymentNoticeContext === "bank_payment_offer"
        ? "proxy"
        : paymentRequestId
          ? "request"
          : "contact";
    if (isPaymentAuthorized && !isPaymentAuthorized())
      return { _tag: "AuthorizationChanged" };
    const { currentNpub, currentNsec } = deps;
    if (!currentNsec || !currentNpub) return { _tag: "MissingIdentity" };

    const contactNpub = (contact.npub ?? "").trim();
    const recipientPubkey = decodeNpub(contactNpub);
    if (!recipientPubkey) return { _tag: "MissingContactNpub" };
    const parsedContactId = ContactId.fromUnknown(contact.id);
    if (!parsedContactId.ok) return { _tag: "InvalidContact" };
    const contactId = parsedContactId.value;

    const current = await balances();
    logPayStep("start", {
      amountSat,
      cashuBalance: current.spendable,
      contactId,
      fromQueue: Boolean(fromQueue),
    });

    if (!deps.isOnline()) {
      const clientId = makeLocalId();
      const appended = chat.appendLocalNostrMessage({
        clientId,
        contactId,
        content: payment.offlineNotice,
        createdAtSec: nowSeconds(),
        direction: "out",
        localOnly: true,
        pubkey: "",
        rumorId: null,
        status: "pending",
        wrapId: `pending:pay:${clientId}`,
      });
      const written = await appended.written;
      if (!appended.id || !written.ok)
        return {
          _tag: "NotStored",
          detail: written.ok ? "failed to persist message" : written.error,
        };
      logPayStep("queued-offline", {
        amountSat,
        contactId,
        messageId: appended.id,
      });
      chat.enqueuePendingPayment({
        amountSat,
        contactId,
        recipientPubkey,
        messageId: appended.id,
      });
      return { _tag: "QueuedOffline", contactId };
    }

    const mint = sendMint(current, amountSat);
    if (mint === null) return { _tag: "Insufficient" };
    logPayStep("mint-selected", { amountSat, mint });
    options?.onSending?.();

    const logFailure = (
      error: string,
      mintUrl: string | null,
      phase: "publish" | "swap",
    ): void => {
      if (logCompletedOnly) return;
      logPaymentEvent({
        amount: amountSat,
        contactId,
        direction: "out",
        error,
        fee: null,
        method: "cashu_chat",
        mint: mintUrl,
        paymentType,
        phase,
        status: "error",
        unit: "sat",
      });
    };

    let receipt: SendReceipt;
    try {
      const sent = await linkshu.sendCashuToken({
        amountSat,
        memo: note,
        mint,
        produceAs: "pending",
      });
      if (Result.isFailure(sent)) {
        const detail = describeError(sent.failure);
        logFailure(detail, mint, "swap");
        return {
          _tag: "Failed",
          detail,
          insufficient: sent.failure._tag === "InsufficientFunds",
        };
      }
      receipt = sent.success;
    } catch (error) {
      const detail = getUnknownErrorMessage(error, "unknown");
      logFailure(detail, mint, "swap");
      return { _tag: "Failed", detail, insufficient: false };
    }

    if (isPaymentAuthorized && !isPaymentAuthorized()) {
      reportAppLog({
        tag: "paymentRequest.authorizationLost",
        summary:
          "Payment authorization changed before token delivery; returning funds",
        links: { operation: receipt.operationId },
        payload: null,
      });
      try {
        const restored = await linkshu.cashuTransferLifecycle.returnToWallet(
          receipt.operationId,
        );
        if (Result.isFailure(restored))
          logFailure(restored.failure._tag, receipt.mint, "swap");
      } catch (error) {
        logFailure(
          getUnknownErrorMessage(error, "return-to-wallet failed"),
          receipt.mint,
          "swap",
        );
      }
      return { _tag: "AuthorizationChanged" };
    }
    logPayStep("swap-ok", {
      changeAmount: receipt.changeAmount,
      feePaid: receipt.feePaid,
      mint: receipt.mint,
      sendAmount: receipt.amount,
    });

    let publishing;
    try {
      publishing = await publishCashuMessagePayment({
        appendLocalNostrMessage: chat.appendLocalNostrMessage,
        batches: [
          {
            amount: receipt.amount,
            mint: receipt.mint,
            token: receipt.tokenText,
            unit: receipt.unit,
          },
        ],
        contactId,
        contactNpub,
        currentNpub,
        enqueueOutbox: deps.linkstr.enqueueOutbox,
        logPayStep,
        nostrMessagesLocal: chat.nostrMessagesLocal,
        ...(paymentNoticeContext ? { paymentNoticeContext } : {}),
        ...(paymentNoticeOfferId ? { paymentNoticeOfferId } : {}),
        pendingMessageId: pendingMessageId?.trim() || null,
        ...(replyContext ? { replyContext } : {}),
        sendPaymentNotice: deps.linkstr.sendPaymentNotice,
        updateLocalNostrMessage: chat.updateLocalNostrMessage,
      });
    } catch (error) {
      // The send row stays `pending`: the outbox may still deliver the
      // message, and the pending-row cleanup effect / return-to-wallet
      // cover both outcomes.
      const detail = getUnknownErrorMessage(error, "unknown");
      logFailure(detail, receipt.mint, "publish");
      return { _tag: "Failed", detail, insufficient: false };
    }

    if (!publishing.hasPendingMessages) {
      // The message carrying the token is published; the funds are the
      // contact's now, so the pending row has nothing left to guard.
      await linkshu.cashuTransferLifecycle.forget(receipt.operationId);
      reportCashuSendForgotten({
        mint: receipt.mint,
        reason: "message-published",
        operationId: receipt.operationId,
      });
    }
    if (!logCompletedOnly || !publishing.hasPendingMessages) {
      logPaymentEvent({
        amount: receipt.amount,
        contactId,
        details: {
          issuedToken: receipt.tokenText,
          ...(paymentRequestId ? { requestId: paymentRequestId } : {}),
        },
        direction: "out",
        error: null,
        fee: null,
        method: "cashu_chat",
        mint: receipt.mint,
        note,
        paymentType,
        phase: publishing.hasPendingMessages ? "publish" : "complete",
        status: "ok",
        transactionId: transactionIdForOperation(receipt.operationId),
        unit: "sat",
      });
    }
    return {
      _tag: "Sent",
      receipt,
      contactId,
      queued: publishing.hasPendingMessages,
      publishErrors: publishing.publishErrors.map((entry) => entry.error),
    };
  };

  const payContact: PaymentsCommands["payContact"] = async (
    payment,
    chat,
    options,
  ) => {
    const paid = await ops.runExclusiveTask(() =>
      payContactNow(payment, chat, options),
    );
    return Option.getOrElse(paid, () => BUSY);
  };

  const payCashuPaymentRequestByPost: PaymentsCommands["payCashuPaymentRequestByPost"] =
    async (request) => {
      const allowHttp = deps.allowHttpPost;
      const postUrlRaw = (request.transportPostUrl ?? "").trim();
      if (!postUrlRaw) return { _tag: "NoPostTransport" };
      let postUrl: URL;
      try {
        postUrl = new URL(postUrlRaw);
      } catch {
        return { _tag: "InvalidUrl" };
      }
      // An `http:` POST target exposes the bearer proofs to anyone on the
      // network path, so it is only accepted in development builds.
      if (!isAllowedPaymentRequestPostUrl(postUrlRaw, { allowHttp }))
        return { _tag: "InsecureTransport" };
      const current = await balances();
      if (current.spendable < request.amount) return { _tag: "Insufficient" };

      const paid = await ops.runExclusiveTask(
        async (): Promise<PayRequestByPostOutcome> => {
          let sentMint: string | null = null;
          const logFailure = (
            error: string,
            mint: string | null,
            phase: "publish" | "swap",
          ): void =>
            logPaymentEvent({
              direction: "out",
              status: "error",
              amount: request.amount,
              fee: null,
              mint,
              unit: "sat",
              error,
              contactId: null,
              method: "cashu_chat",
              paymentType: "request",
              phase,
            });
          try {
            const requestedMints = new Set(
              request.mintUrls.flatMap((mint) => {
                const normalized = normalizeMintUrl(mint);
                return normalized ? [normalized] : [];
              }),
            );
            const eligible =
              requestedMints.size > 0
                ? current.perMint.filter((entry) =>
                    requestedMints.has(normalizeMintUrl(entry.mint)),
                  )
                : current.perMint;
            const preferredMint =
              request.mintUrls
                .map((mint) => normalizeMintUrl(mint))
                .find(Boolean) ?? normalizeMintUrl(deps.defaultMint ?? "");
            const mint = planSendMint({
              balances: eligible,
              isPreferredMint: isSpellingOf(preferredMint),
              amount: request.amount,
            });
            if (mint === null) return { _tag: "Insufficient" };

            const sent = await linkshu.sendCashuToken({
              amountSat: request.amount,
              memo: request.description,
              mint,
              produceAs: "pending",
            });
            if (Result.isFailure(sent)) {
              const detail = describeError(sent.failure);
              logFailure(detail, mint, "swap");
              return {
                _tag: "Failed",
                detail,
                insufficient: sent.failure._tag === "InsufficientFunds",
              };
            }
            const receipt = sent.success;
            sentMint = receipt.mint;

            const delivery = await postPaymentRequestPayload({
              url: postUrl.toString(),
              payload: {
                id: request.requestId,
                memo: request.description,
                mint: receipt.mint,
                unit: receipt.unit,
                proofs: receipt.proofs,
              },
              allowHttp,
            });
            if (delivery._tag !== "Delivered") {
              // The POST recipient may hold the proofs now; re-receiving kills
              // that encoding at the mint before the funds return to balance.
              const restored =
                await linkshu.cashuTransferLifecycle.returnToWallet(
                  receipt.operationId,
                );
              if (Result.isFailure(restored))
                console.warn(
                  "[linky][payment-request] return-to-wallet failed",
                  {
                    error: restored.failure._tag,
                  },
                );
              throw new Error(describePostFailure(delivery));
            }

            await linkshu.cashuTransferLifecycle.forget(receipt.operationId);
            reportCashuSendForgotten({
              mint: receipt.mint,
              reason: "payment-request-posted",
              operationId: receipt.operationId,
            });
            logPaymentEvent({
              direction: "out",
              status: "ok",
              transactionId: transactionIdForOperation(receipt.operationId),
              amount: receipt.amount,
              details: {
                issuedToken: receipt.tokenText,
                ...(request.requestId ? { requestId: request.requestId } : {}),
                postUrl: postUrl.toString(),
              },
              fee: null,
              mint: receipt.mint,
              note: request.description,
              unit: receipt.unit,
              error: null,
              contactId: null,
              method: "cashu_chat",
              paymentType: "request",
              phase: "complete",
            });
            return { _tag: "Paid", receipt, postUrl };
          } catch (error) {
            const detail = getUnknownErrorMessage(error, "unknown");
            logFailure(detail, sentMint, "publish");
            return { _tag: "Failed", detail, insufficient: false };
          }
        },
      );
      return Option.getOrElse(paid, () => BUSY);
    };

  return {
    fundsFor,
    payCashuPaymentRequestByPost,
    payContact,
    payLightningAddress,
    payLightningInvoice,
  };
};

/**
 * Payments over the current linkshu runtime and the wallet queue; each
 * resolves with its own outcome, and nothing a screen does interrupts one.
 */
export const paymentsCommandsAtom = Atom.readable((get) =>
  AsyncResult.map(
    AsyncResult.all({
      linkshu: get(linkshuCommandsAtom),
      paymentLog: get(paymentLogAtom),
    }),
    ({ linkshu, paymentLog }) =>
      makePaymentsCommands({
        allowHttpPost: get(platformAtom).config.isDev,
        allowTestMints: get(allowTestMintsAtom),
        currentNpub: get(currentNpubAtom),
        currentNsec: get(currentNsecAtom),
        defaultMint: get(defaultMintAtom),
        isOnline: get(platformAtom).lifecycle.isOnline,
        linkshu,
        linkstr: linkstrCommands(get.registry),
        logPaymentEvent: paymentLog.logPaymentEvent,
        ops: get(walletOpsAtom),
      }),
  ),
);
