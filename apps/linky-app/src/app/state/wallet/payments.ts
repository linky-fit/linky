import {
  ContactId,
  transactionIdForOperation,
  transactionIdForQuote,
} from "@linky-fit/linksync";
import {
  buildPaymentAmountAttempts,
  buildPaymentFailureAmountAttempts,
  encodePaymentRequestPayload,
  getLightningInvoicePreview,
  isAllowedPaymentRequestPostUrl,
  isRetryablePaymentAmountFailure,
  mintMoveCovers,
  planSendMint,
  postPaymentRequestPayload,
  type AutoswapReceipt,
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
  type RelayUrl,
} from "@linky-fit/linkstr";
import { Option, Predicate, Result } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { getMintFeePpk } from "../../hooks/mint/mintInfoHelpers";
import { requestMintUrls } from "../../hooks/mint/useRequestMintUrls";
import {
  fetchLnurlInvoiceForTarget,
  inferLightningAddressFromLnurlTarget,
  type LnurlPaySuccessAction,
} from "../../../lnurlPay";
import { normalizeMintUrl } from "../../../utils/mint";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import type { ReplyContext } from "../../hooks/messages/useSendChatMessage";
import { publishCashuMessagePayment } from "../../hooks/payments/publishCashuMessagePayment";
import { reportCashuSendForgotten } from "../../lib/cashuSendInspector";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { isSpellingOf } from "../../lib/mintSpelling";
import {
  reportPaymentRequestDelivery,
  reportPaymentRequestLightningMove,
  reportPaymentRequestPlanned,
} from "../../lib/paymentRequestInspector";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import { visibleWalletBalances } from "../../lib/testMintGate";
import type {
  ContactPayRowLike,
  ContactRowLike,
  PaymentTelemetryMethod,
  PaymentTelemetryPaymentType,
} from "../../types/appTypes";
import { linkshuCommandsAtom, type LinkshuCommands } from "../linkshu/commands";
import { chatWritesAtom, type ChatWrites } from "../messages/chatWrites";
import {
  linkstrCommands,
  type LinkstrCommands,
} from "@linky-fit/linkstr-react";
import { platformAtom } from "../platform";
import { allowTestMintsAtom } from "../session/settings";
import { currentNpubAtom, currentNsecAtom } from "../session/session";
import { defaultMintAtom } from "./defaultMint";
import { mintInfoByUrlAtom, mintInfoDedupedAtom } from "./mintInfo";
import { planDefaultMintMove } from "./moveFunds";
import {
  planPaymentRequestMint,
  sendFeeAllowance,
  type PaymentRequestMintPlan,
} from "./paymentRequestPlan";
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
/** The device is offline or the mint could not be reached. */
interface NetworkFailure {
  readonly _tag: "NetworkError";
}

export type PayInvoiceOutcome =
  | { readonly _tag: "Paid"; readonly receipt: MeltReceipt }
  /** The mint took the melt but has not settled it; recovery finishes it. */
  | { readonly _tag: "Pending"; readonly pending: PaymentPending }
  | Shortfall
  | Busy
  | Failed
  | Invalid
  | NetworkFailure;

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
  | Invalid
  | NetworkFailure;

export interface ContactPayment {
  readonly amountSat: number;
  readonly contact: ContactRowLike;
  /** Records only the completed payment, not failed steps. */
  readonly logCompletedOnly?: boolean;
  /** Travels as the token's memo and is kept as the transaction note. */
  readonly memo?: string | null;
  readonly paymentNoticeContext?: PaymentNoticeContext;
  readonly paymentNoticeOfferId?: string;
  /** Checked before the token is made and again before it is sent. */
  readonly isPaymentAuthorized?: () => boolean;
  readonly replyContext?: ReplyContext | null;
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
  | { readonly _tag: "AuthorizationChanged" }
  | { readonly _tag: "MissingIdentity" }
  | { readonly _tag: "MissingContactNpub" }
  | { readonly _tag: "InvalidContact" }
  | { readonly _tag: "Insufficient" }
  | {
      readonly _tag: "Failed";
      readonly detail: string;
      readonly insufficient: boolean;
    }
  | NetworkFailure
  | Busy;

/** A priced way to pay a NUT-18 request; `amount + fee` leaves the wallet. */
export type PaymentRequestQuote =
  | {
      readonly _tag: "Direct";
      readonly amount: number;
      readonly fee: number;
      readonly mint: MintUrl;
      /** The request's `mf`, sent on top of `amount`; part of `fee`. */
      readonly methodFee: number;
    }
  | {
      readonly _tag: "Lightning";
      readonly amount: number;
      readonly fee: number;
      readonly sourceMint: MintUrl;
      readonly targetMint: string;
      /** The target joins the user's mint list once they agree. */
      readonly addsMint: boolean;
      /** What the move issues at the target: the amount plus the send's fee allowance. */
      readonly moveAmount: number;
    };

export type QuotePaymentRequestOutcome =
  | PaymentRequestQuote
  | Shortfall
  /** The Lightning target cannot lock proofs to the request's key (NUT-11). */
  | { readonly _tag: "LockingUnsupported" }
  | Failed
  | NetworkFailure;

export interface PaymentRequestPayment {
  readonly request: CashuPaymentRequestMessageInfo;
  readonly quote: PaymentRequestQuote;
  /** The contact of the request's nostr transport; null pays its POST target. */
  readonly recipient: ContactRowLike | null;
  readonly replyContext?: ReplyContext | null;
  /** Checked before anything moves and again before the payload is sent. */
  readonly isPaymentAuthorized?: () => boolean;
}

export type PayPaymentRequestOutcome =
  | {
      readonly _tag: "Paid";
      readonly receipt: SendReceipt;
      /** The recipient's conversation; null for a POST target. */
      readonly contactId: ContactId | null;
      /** The payload message is stored but no relay took it yet. */
      readonly queued: boolean;
    }
  | { readonly _tag: "AuthorizationChanged" }
  | { readonly _tag: "MissingIdentity" }
  | { readonly _tag: "InvalidContact" }
  | { readonly _tag: "NoTransport" }
  | { readonly _tag: "InsecureTransport" }
  | { readonly _tag: "LockingUnsupported" }
  | {
      readonly _tag: "Failed";
      readonly detail: string;
      readonly insufficient: boolean;
      /** The Lightning move already put the sats at this mint, where they stay. */
      readonly movedTo: string | null;
    }
  /** Nothing left the wallet; a failure after a Lightning move is `Failed` with `movedTo`. */
  | NetworkFailure
  | Busy;

export interface LightningInvoiceQuote {
  readonly _tag: "Quoted";
  readonly amount: number;
  /** The most the payment can cost beyond `amount`: the Lightning fee reserve and cashu input fees; unused reserve comes back. */
  readonly fee: number;
  readonly mint: MintUrl;
}

export type QuoteLightningInvoiceOutcome =
  | LightningInvoiceQuote
  | { readonly _tag: "Invalid" }
  | { readonly _tag: "Insufficient" }
  | Failed
  | NetworkFailure;

interface SendingOptions {
  /** Runs once the payment leaves the wallet's checks, before any mint call. */
  readonly onSending?: () => void;
}

/** A payment runs while the user waits: offline it fails with `NetworkError`, it is never queued for later. */
export interface PaymentsCommands {
  readonly fundsFor: (amountSat: number) => Promise<FundsCheck>;
  readonly payLightningInvoice: (
    invoice: string,
    options?: SendingOptions,
  ) => Promise<PayInvoiceOutcome>;
  /** Prices an invoice at the mint that would pay it; nothing moves. */
  readonly quoteLightningInvoice: (
    invoice: string,
  ) => Promise<QuoteLightningInvoiceOutcome>;
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
    options?: SendingOptions,
  ) => Promise<PayContactOutcome>;
  /** Picks and prices the mint a NUT-18 request of `amountSat` is paid from. */
  readonly quotePaymentRequest: (
    request: CashuPaymentRequestMessageInfo,
    amountSat: number,
  ) => Promise<QuotePaymentRequestOutcome>;
  /** Pays a quoted request over its transport; plain-http POST only in development builds. */
  readonly payPaymentRequest: (
    payment: PaymentRequestPayment,
    options?: SendingOptions,
  ) => Promise<PayPaymentRequestOutcome>;
}

export interface PaymentsDeps {
  /** Accepts plain-http payment request POST targets (development builds). */
  readonly allowHttpPost: boolean;
  readonly allowTestMints: boolean;
  readonly chat: Pick<
    ChatWrites,
    "appendLocalNostrMessage" | "latestMessages" | "updateLocalNostrMessage"
  >;
  readonly defaultMint: string | null;
  readonly currentNpub: string | null;
  readonly currentNsec: string | null;
  readonly isOnline: () => boolean;
  readonly linkshu: Pick<
    LinkshuCommands,
    | "autoswapCashu"
    | "cashuTransferLifecycle"
    | "estimateAutoswapCashu"
    | "fetchMintInfo"
    | "meltCashuInvoice"
    | "quoteCashuMelt"
    | "readWalletBalances"
    | "sendCashuToken"
  >;
  readonly linkstr: Pick<
    LinkstrCommands,
    "enqueueOutbox" | "sendPaymentNotice"
  >;
  readonly logPaymentEvent: PaymentLog["logPaymentEvent"];
  /** The stored NUT-02 input fee of a mint in the user's list; null when unknown. */
  readonly mintFeePpk: (mint: string) => number | null;
  readonly ops: Pick<WalletOps, "runExclusiveTask">;
  /** The user's mint list, default mint first, without hidden test mints. */
  readonly userMints: () => ReadonlyArray<string>;
}

const BUSY: Busy = { _tag: "Busy" };
const NETWORK_FAILURE: NetworkFailure = { _tag: "NetworkError" };

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

  /** Checked once a step failed, since the device can go offline mid-payment. */
  const isNetworkFailure = (error: unknown): boolean =>
    !deps.isOnline() || Predicate.isTagged(error, "MintUnreachable");

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
      { detail: string; pending: PaymentPending | null; network: boolean }
    >
  > => {
    try {
      const outcome = await linkshu.meltCashuInvoice({ invoice, mint });
      if (Result.isSuccess(outcome)) return Result.succeed(outcome.success);
      return Result.fail({
        detail: describeError(outcome.failure),
        pending:
          outcome.failure._tag === "PaymentPending" ? outcome.failure : null,
        network: isNetworkFailure(outcome.failure),
      });
    } catch (error) {
      return Result.fail({
        detail: describeError(error),
        pending: null,
        network: isNetworkFailure(error),
      });
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

  const fundsFor: PaymentsCommands["fundsFor"] = async (amountSat) => {
    const current = await balances();
    if (amountSat <= current.spendable) return { _tag: "Covered" };
    return shortfall(current, amountSat);
  };

  const payLightningInvoice: PaymentsCommands["payLightningInvoice"] = async (
    invoice,
    options,
  ) => {
    const normalized = invoice.trim();
    if (!normalized) return { _tag: "Invalid" };
    if (!deps.isOnline()) return NETWORK_FAILURE;
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
          const { detail, pending, network } = outcome.failure;
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
          return network ? NETWORK_FAILURE : { _tag: "Failed", detail };
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
    if (!deps.isOnline()) return NETWORK_FAILURE;

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
        let networkFailed = false;
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
            networkFailed = !deps.isOnline();
            if (!networkFailed && canRetryLower(errorMessage)) continue;
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
            const { detail, pending, network } = outcome.failure;
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
            networkFailed = network;
            if (!network && canRetryLower(detail)) continue;
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
        return networkFailed ? NETWORK_FAILURE : { _tag: "Failed", detail };
      },
    );
    return Option.getOrElse(paid, () => BUSY);
  };

  /** Takes a pending send back into the balance; the error when that failed. */
  const returnSend = async (operationId: string): Promise<string | null> => {
    try {
      const restored =
        await linkshu.cashuTransferLifecycle.returnToWallet(operationId);
      return Result.isFailure(restored) ? restored.failure._tag : null;
    } catch (error) {
      return getUnknownErrorMessage(error, "return-to-wallet failed");
    }
  };

  /**
   * Publishes a send's message to its contact and closes the pending send
   * once a relay took it; an unpublished one stays pending, guarded by the
   * pending-row cleanup and return-to-wallet.
   */
  const publishSend = async (args: {
    readonly receipt: SendReceipt;
    readonly content: string;
    readonly contactId: ContactId;
    readonly contactNpub: string;
    readonly currentNpub: string;
    readonly paymentNoticeContext?: PaymentNoticeContext | undefined;
    readonly paymentNoticeOfferId?: string | undefined;
    readonly recipientRelays?: ReadonlyArray<RelayUrl>;
    readonly replyContext?: ReplyContext | null | undefined;
  }) => {
    const { chat } = deps;
    const { receipt } = args;
    const publishing = await publishCashuMessagePayment({
      appendLocalNostrMessage: chat.appendLocalNostrMessage,
      batches: [
        {
          amount: receipt.amount,
          mint: receipt.mint,
          token: args.content,
          unit: receipt.unit,
        },
      ],
      contactId: args.contactId,
      contactNpub: args.contactNpub,
      currentNpub: args.currentNpub,
      enqueueOutbox: deps.linkstr.enqueueOutbox,
      logPayStep,
      nostrMessagesLocal: chat.latestMessages(),
      ...(args.paymentNoticeContext
        ? { paymentNoticeContext: args.paymentNoticeContext }
        : {}),
      ...(args.paymentNoticeOfferId
        ? { paymentNoticeOfferId: args.paymentNoticeOfferId }
        : {}),
      pendingMessageId: null,
      ...(args.recipientRelays
        ? { recipientRelays: args.recipientRelays }
        : {}),
      ...(args.replyContext ? { replyContext: args.replyContext } : {}),
      sendPaymentNotice: deps.linkstr.sendPaymentNotice,
      updateLocalNostrMessage: chat.updateLocalNostrMessage,
    });
    if (!publishing.hasPendingMessages) {
      await linkshu.cashuTransferLifecycle.forget(receipt.operationId);
      reportCashuSendForgotten({
        mint: receipt.mint,
        reason: "message-published",
        operationId: receipt.operationId,
      });
    }
    return publishing;
  };

  const payContactNow = async (
    payment: ContactPayment,
    options: SendingOptions | undefined,
  ): Promise<PayContactOutcome> => {
    const {
      amountSat,
      contact,
      logCompletedOnly = false,
      memo,
      paymentNoticeContext,
      paymentNoticeOfferId,
      isPaymentAuthorized,
      replyContext,
    } = payment;
    const note = (memo ?? "").trim() || null;
    // Settling a bank offer is the sats leg of a proxy payment.
    const paymentType: PaymentTelemetryPaymentType =
      paymentNoticeContext === "bank_payment_offer" ? "proxy" : "contact";
    if (isPaymentAuthorized && !isPaymentAuthorized())
      return { _tag: "AuthorizationChanged" };
    const { currentNpub, currentNsec } = deps;
    if (!currentNsec || !currentNpub) return { _tag: "MissingIdentity" };

    const contactNpub = (contact.npub ?? "").trim();
    if (!decodeNpub(contactNpub)) return { _tag: "MissingContactNpub" };
    const parsedContactId = ContactId.fromUnknown(contact.id);
    if (!parsedContactId.ok) return { _tag: "InvalidContact" };
    const contactId = parsedContactId.value;
    if (!deps.isOnline()) return NETWORK_FAILURE;

    const current = await balances();
    logPayStep("start", {
      amountSat,
      cashuBalance: current.spendable,
      contactId,
    });

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
        if (isNetworkFailure(sent.failure)) return NETWORK_FAILURE;
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
      if (isNetworkFailure(error)) return NETWORK_FAILURE;
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
      const notReturned = await returnSend(receipt.operationId);
      if (notReturned !== null) logFailure(notReturned, receipt.mint, "swap");
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
      publishing = await publishSend({
        receipt,
        content: receipt.tokenText,
        contactId,
        contactNpub,
        currentNpub,
        paymentNoticeContext,
        paymentNoticeOfferId,
        replyContext,
      });
    } catch (error) {
      // The send row stays `pending`: the outbox may still deliver the
      // message, and the pending-row cleanup effect / return-to-wallet
      // cover both outcomes.
      const detail = getUnknownErrorMessage(error, "unknown");
      logFailure(detail, receipt.mint, "publish");
      return { _tag: "Failed", detail, insufficient: false };
    }

    if (!logCompletedOnly || !publishing.hasPendingMessages) {
      logPaymentEvent({
        amount: receipt.amount,
        contactId,
        details: { issuedToken: receipt.tokenText },
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
    options,
  ) => {
    const paid = await ops.runExclusiveTask(() =>
      payContactNow(payment, options),
    );
    return Option.getOrElse(paid, () => BUSY);
  };

  const quoteLightning = async (
    plan: Extract<PaymentRequestMintPlan, { _tag: "Lightning" }>,
    request: CashuPaymentRequestMessageInfo,
    amountSat: number,
  ): Promise<QuotePaymentRequestOutcome> => {
    const quoteFailed = (error: unknown): QuotePaymentRequestOutcome =>
      isNetworkFailure(error)
        ? NETWORK_FAILURE
        : { _tag: "Failed", detail: describeError(error) };
    let info;
    try {
      const fetched = await linkshu.fetchMintInfo(plan.targetMint);
      if (Result.isFailure(fetched)) return quoteFailed(fetched.failure);
      info = fetched.success;
    } catch (error) {
      return quoteFailed(error);
    }
    if (request.lockTo !== null && !info.supportsP2pk)
      return { _tag: "LockingUnsupported" };
    const moveAmount =
      amountSat + sendFeeAllowance(info.inputFeePpk, amountSat);
    let lastError: unknown = null;
    for (const source of plan.sources) {
      try {
        const estimated = await linkshu.estimateAutoswapCashu({
          sourceMint: source.mint,
          targetMint: plan.targetMint,
          amountSat: moveAmount,
        });
        if (Result.isFailure(estimated)) {
          if (estimated.failure._tag !== "InsufficientFunds")
            lastError = estimated.failure;
          continue;
        }
        const { totalFromSource } = estimated.success;
        if (totalFromSource > source.amount) continue;
        return {
          _tag: "Lightning",
          amount: amountSat,
          fee: totalFromSource - amountSat,
          sourceMint: source.mint,
          targetMint: plan.targetMint,
          addsMint: plan.addsMint,
          moveAmount,
        };
      } catch (error) {
        lastError = error;
      }
    }
    return lastError === null
      ? { _tag: "Insufficient" }
      : quoteFailed(lastError);
  };

  const quoteLightningInvoice: PaymentsCommands["quoteLightningInvoice"] =
    async (invoice) => {
      const normalized = invoice.trim();
      const amountSat = getLightningInvoicePreview(normalized)?.amountSat;
      if (amountSat === undefined || amountSat === null) {
        return { _tag: "Invalid" };
      }
      if (!deps.isOnline()) return NETWORK_FAILURE;
      const mint = sendMint(await balances(), amountSat);
      if (mint === null) return { _tag: "Insufficient" };
      try {
        const outcome = await linkshu.quoteCashuMelt({
          invoice: normalized,
          mint,
        });
        if (Result.isFailure(outcome)) {
          return isNetworkFailure(outcome.failure)
            ? NETWORK_FAILURE
            : { _tag: "Failed", detail: describeError(outcome.failure) };
        }
        const { maxTotal, quote } = outcome.success;
        return {
          _tag: "Quoted",
          amount: quote.amount,
          fee: maxTotal - quote.amount,
          mint,
        };
      } catch (error) {
        return isNetworkFailure(error)
          ? NETWORK_FAILURE
          : { _tag: "Failed", detail: describeError(error) };
      }
    };

  const quotePaymentRequest: PaymentsCommands["quotePaymentRequest"] = async (
    request,
    amountSat,
  ) => {
    if (!deps.isOnline()) return NETWORK_FAILURE;
    const plan = planPaymentRequestMint({
      amount: amountSat,
      acceptedMints: request.mintUrls,
      mintsAdvisory: request.mintsAdvisory,
      outsideMintFee: request.outsideMintFee,
      allowTestMints: deps.allowTestMints,
      balances: await balances(),
      defaultMint: deps.defaultMint,
      userMints: deps.userMints(),
      sendFee: (mint, amount) =>
        sendFeeAllowance(deps.mintFeePpk(mint), amount),
    });
    const quote: QuotePaymentRequestOutcome =
      plan._tag === "Direct"
        ? {
            _tag: "Direct",
            amount: amountSat,
            fee:
              sendFeeAllowance(deps.mintFeePpk(plan.mint), amountSat) +
              plan.methodFee,
            mint: plan.mint,
            methodFee: plan.methodFee,
          }
        : plan._tag === "Lightning"
          ? await quoteLightning(plan, request, amountSat)
          : plan;
    reportPaymentRequestPlanned({
      requestId: request.requestId,
      amount: amountSat,
      plan: quote._tag,
      fee: "fee" in quote ? quote.fee : null,
      mint:
        quote._tag === "Direct"
          ? quote.mint
          : quote._tag === "Lightning"
            ? quote.targetMint
            : null,
      sourceMint: quote._tag === "Lightning" ? quote.sourceMint : null,
      addsMint: quote._tag === "Lightning" && quote.addsMint,
      acceptedMints: request.mintUrls,
    });
    return quote;
  };

  /** Where the payload goes: the recipient's conversation or the POST url. */
  const requestTransport = (
    request: CashuPaymentRequestMessageInfo,
    recipient: ContactRowLike | null,
  ):
    | {
        readonly _tag: "Nostr";
        readonly contactId: ContactId;
        readonly contactNpub: string;
        readonly currentNpub: string;
      }
    | { readonly _tag: "Post"; readonly url: string }
    | Extract<
        PayPaymentRequestOutcome,
        {
          readonly _tag:
            | "InsecureTransport"
            | "InvalidContact"
            | "MissingIdentity"
            | "NoTransport";
        }
      > => {
    if (recipient !== null) {
      const { currentNpub, currentNsec } = deps;
      if (!currentNsec || !currentNpub) return { _tag: "MissingIdentity" };
      const contactNpub = (recipient.npub ?? "").trim();
      const parsedContactId = ContactId.fromUnknown(recipient.id);
      if (!decodeNpub(contactNpub) || !parsedContactId.ok)
        return { _tag: "InvalidContact" };
      return {
        _tag: "Nostr",
        contactId: parsedContactId.value,
        contactNpub,
        currentNpub,
      };
    }
    const url = (request.transportPostUrl ?? "").trim();
    if (!url) return { _tag: "NoTransport" };
    // An `http:` POST target exposes the bearer proofs to anyone on the
    // network path, so it is only accepted in development builds.
    return isAllowedPaymentRequestPostUrl(url, {
      allowHttp: deps.allowHttpPost,
    })
      ? { _tag: "Post", url }
      : { _tag: "InsecureTransport" };
  };

  const moveForRequest = async (
    quote: Extract<PaymentRequestQuote, { _tag: "Lightning" }>,
    request: CashuPaymentRequestMessageInfo,
  ): Promise<
    Result.Result<AutoswapReceipt, { detail: string; network: boolean }>
  > => {
    const report = (
      outcome: "moved" | "failed",
      receipt: AutoswapReceipt | null,
      detail: string | null,
    ) =>
      reportPaymentRequestLightningMove({
        requestId: request.requestId,
        sourceMint: quote.sourceMint,
        targetMint: quote.targetMint,
        moveAmount: quote.moveAmount,
        outcome,
        operationId: receipt?.operationId ?? null,
        feePaid: receipt?.feePaid ?? null,
        detail,
      });
    try {
      const moved = await linkshu.autoswapCashu({
        sourceMint: quote.sourceMint,
        targetMint: quote.targetMint,
        amountSat: quote.moveAmount,
      });
      if (Result.isFailure(moved)) {
        const detail = describeError(moved.failure);
        report("failed", null, detail);
        return Result.fail({
          detail,
          network: isNetworkFailure(moved.failure),
        });
      }
      report("moved", moved.success, null);
      return Result.succeed(moved.success);
    } catch (error) {
      const detail = describeError(error);
      report("failed", null, detail);
      return Result.fail({ detail, network: isNetworkFailure(error) });
    }
  };

  const payPaymentRequest: PaymentsCommands["payPaymentRequest"] = async (
    { request, quote, recipient, replyContext, isPaymentAuthorized },
    options,
  ) => {
    const isAuthorized = () => !isPaymentAuthorized || isPaymentAuthorized();
    const transport = requestTransport(request, recipient);
    if (transport._tag !== "Nostr" && transport._tag !== "Post")
      return transport;
    if (!isAuthorized()) return { _tag: "AuthorizationChanged" };
    if (!deps.isOnline()) return NETWORK_FAILURE;
    const contactId = transport._tag === "Nostr" ? transport.contactId : null;
    const amountSat = quote.amount;

    const paid = await ops.runExclusiveTask(
      async (): Promise<PayPaymentRequestOutcome> => {
        options?.onSending?.();
        let movedTo: string | null = null;
        const logFailure = (
          detail: string,
          mint: string | null,
          phase: "publish" | "swap",
        ) =>
          logPaymentEvent({
            amount: amountSat,
            contactId,
            direction: "out",
            error: detail,
            fee: null,
            method: "cashu_chat",
            mint,
            paymentType: "request",
            phase,
            status: "error",
            unit: "sat",
          });
        const failed = (
          detail: string,
          mint: string | null,
          phase: "publish" | "swap",
          { insufficient = false, network = false } = {},
        ): PayPaymentRequestOutcome => {
          logFailure(detail, mint, phase);
          if (network && movedTo === null) return NETWORK_FAILURE;
          return { _tag: "Failed", detail, insufficient, movedTo };
        };

        let mint: string;
        let moveFee = 0;
        if (quote._tag === "Lightning") {
          const moved = await moveForRequest(quote, request);
          if (Result.isFailure(moved))
            return failed(moved.failure.detail, quote.sourceMint, "swap", {
              network: moved.failure.network,
            });
          mint = moved.success.targetMint;
          moveFee = moved.success.feePaid;
          movedTo = mint;
        } else mint = quote.mint;

        let receipt: SendReceipt;
        try {
          const sent = await linkshu.sendCashuToken({
            amountSat:
              quote._tag === "Direct" ? amountSat + quote.methodFee : amountSat,
            memo: request.description,
            mint,
            produceAs: "pending",
            lockTo: request.lockTo,
            includeRecipientFee: true,
          });
          if (Result.isFailure(sent)) {
            if (sent.failure._tag === "LockingUnsupported" && movedTo === null)
              return { _tag: "LockingUnsupported" };
            return failed(describeError(sent.failure), mint, "swap", {
              insufficient: sent.failure._tag === "InsufficientFunds",
              network: isNetworkFailure(sent.failure),
            });
          }
          receipt = sent.success;
        } catch (error) {
          return failed(describeError(error), mint, "swap", {
            network: isNetworkFailure(error),
          });
        }

        if (!isAuthorized()) {
          reportAppLog({
            tag: "paymentRequest.authorizationLost",
            summary:
              "Payment authorization changed before token delivery; returning funds",
            links: { operation: receipt.operationId },
            payload: null,
          });
          const notReturned = await returnSend(receipt.operationId);
          if (notReturned !== null)
            logFailure(notReturned, receipt.mint, "swap");
          // The sats already moved over Lightning; the user has to learn where they are.
          if (movedTo !== null)
            return failed("authorization changed", receipt.mint, "swap");
          return { _tag: "AuthorizationChanged" };
        }

        const reportDelivery = (
          outcome: "delivered" | "queued" | "failed",
          detail: string | null,
        ) =>
          reportPaymentRequestDelivery({
            requestId: request.requestId,
            transport: transport._tag === "Nostr" ? "nostr" : "post",
            outcome,
            operationId: receipt.operationId,
            amount: receipt.amount,
            mint: receipt.mint,
            detail,
          });
        const payload = encodePaymentRequestPayload({
          id: request.requestId,
          memo: request.description,
          mint: receipt.mint,
          unit: receipt.unit,
          proofs: receipt.proofs,
        });

        let queued = false;
        if (transport._tag === "Nostr") {
          try {
            const publishing = await publishSend({
              receipt,
              content: payload,
              contactId: transport.contactId,
              contactNpub: transport.contactNpub,
              currentNpub: transport.currentNpub,
              recipientRelays: request.transportRelays,
              replyContext,
            });
            queued = publishing.hasPendingMessages;
          } catch (error) {
            // The send stays pending; return-to-wallet takes it back.
            const detail = getUnknownErrorMessage(error, "unknown");
            reportDelivery("failed", detail);
            return failed(detail, receipt.mint, "publish");
          }
        } else {
          const delivery = await postPaymentRequestPayload({
            url: transport.url,
            payload: {
              id: request.requestId,
              memo: request.description,
              mint: receipt.mint,
              unit: receipt.unit,
              proofs: receipt.proofs,
            },
            allowHttp: deps.allowHttpPost,
          });
          if (delivery._tag !== "Delivered") {
            const detail = describePostFailure(delivery);
            reportDelivery("failed", detail);
            // The POST recipient may hold the proofs now; re-receiving kills
            // that copy at the mint before the funds return to balance.
            const notReturned = await returnSend(receipt.operationId);
            if (notReturned !== null)
              logFailure(notReturned, receipt.mint, "swap");
            return failed(detail, receipt.mint, "publish", {
              network: delivery._tag === "NetworkError" || !deps.isOnline(),
            });
          }
          await linkshu.cashuTransferLifecycle.forget(receipt.operationId);
          reportCashuSendForgotten({
            mint: receipt.mint,
            reason: "payment-request-posted",
            operationId: receipt.operationId,
          });
        }
        reportDelivery(queued ? "queued" : "delivered", null);

        logPaymentEvent({
          amount: receipt.amount,
          contactId,
          details: {
            issuedToken: receipt.tokenText,
            ...(request.requestId ? { requestId: request.requestId } : {}),
            ...(transport._tag === "Post" ? { postUrl: transport.url } : {}),
          },
          direction: "out",
          error: null,
          fee: moveFee + receipt.feePaid,
          method: "cashu_chat",
          mint: receipt.mint,
          note: request.description,
          paymentType: "request",
          phase: queued ? "publish" : "complete",
          status: "ok",
          transactionId: transactionIdForOperation(receipt.operationId),
          unit: "sat",
        });
        return { _tag: "Paid", receipt, contactId, queued };
      },
    );
    return Option.getOrElse(paid, () => BUSY);
  };

  return {
    fundsFor,
    payContact,
    payLightningAddress,
    payLightningInvoice,
    quoteLightningInvoice,
    payPaymentRequest,
    quotePaymentRequest,
  };
};

/**
 * Payments over the current linkshu runtime and the wallet queue; each
 * resolves with its own outcome, and nothing a screen does interrupts one.
 */
export const paymentsCommandsAtom = Atom.readable((get) =>
  AsyncResult.map(
    AsyncResult.all({
      chat: get(chatWritesAtom),
      linkshu: get(linkshuCommandsAtom),
      paymentLog: get(paymentLogAtom),
    }),
    ({ chat, linkshu, paymentLog }) =>
      makePaymentsCommands({
        allowHttpPost: get(platformAtom).config.isDev,
        allowTestMints: get(allowTestMintsAtom),
        chat,
        currentNpub: get(currentNpubAtom),
        currentNsec: get(currentNsecAtom),
        defaultMint: get(defaultMintAtom),
        isOnline: get(platformAtom).lifecycle.isOnline,
        linkshu,
        linkstr: linkstrCommands(get.registry),
        logPaymentEvent: paymentLog.logPaymentEvent,
        mintFeePpk: (mint) =>
          getMintFeePpk(
            get.registry.get(mintInfoByUrlAtom).get(normalizeMintUrl(mint))
              ?.feesJson,
          ),
        ops: get(walletOpsAtom),
        // Read when a request is planned, so mint list changes do not rebuild the commands.
        userMints: () =>
          requestMintUrls({
            allowTestMints: get(allowTestMintsAtom),
            defaultMintUrl: get(defaultMintAtom),
            mintUrls: get.registry
              .get(mintInfoDedupedAtom)
              .map((row) => row.canonicalUrl),
          }),
      }),
  ),
);
