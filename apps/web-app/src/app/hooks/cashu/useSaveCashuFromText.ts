import { transactionIdForOperation } from "@linky-fit/linksync";
import type {
  PaidOverlayContact,
  PaidOverlayDetails,
} from "../../lib/paidOverlay";
import { Either } from "effect";
import React from "react";
import { parseTokenText } from "@linky-fit/linkshu";
import { navigateTo } from "../../../hooks/useRouting";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import type { LoggedPaymentEventParams } from "../../types/appTypes";
import {
  describeTaggedCashuError,
  isTransientCashuErrorTag,
} from "../../lib/cashuStoredError";
import { isUnknownContactId } from "../messages/contactIdentity";
import type { ReceiveCashuToken } from "../composition/useLinkshuComposition";
import { touchReceivingMint } from "../../lib/receivingMint";
import { readCashuTokenMemo } from "../../lib/tokenMessageInfo";
import { isHiddenTestMint } from "../../../utils/mint";
import type { Translate } from "../../../i18n";

interface CashuTokenMetaRow {
  id: string;
  isDeleted?: string | number | boolean | null | undefined;
  lastCheckedAtSec?: number | null | undefined;
}

export interface SaveCashuFromTextOptions {
  /**
   * Started by the app, not the user: no statuses (the inspector records the
   * attempt), no payment-history failure for a token already received here
   * or on another device, or for a transient failure the caller retries, and
   * a token whose deferred receive was closed (discarded) stays closed.
   */
  automatic?: boolean;
  contactId?: string;
  navigateToTokens?: boolean;
  navigateToWallet?: boolean;
  requestId?: string;
  /**
   * Reports whether the attempt ended terminally (received, already known, or
   * permanently spent — never worth retrying) or transiently (mint offline,
   * lock contention — retry later). Lets the caller persist a "do not
   * auto-retry" decision without re-deriving it from token text.
   */
  onResolved?: (resolution: "terminal" | "transient") => void;
}

interface UseSaveCashuFromTextParams {
  allowTestMints: boolean;
  enqueueCashuOp: (op: () => Promise<void>) => Promise<void>;
  /** Names the sender on the paid overlay when the token came from a saved contact. */
  findContact?: (contactId: string) => PaidOverlayContact | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  isCashuTokenStored: (tokenRaw: string) => boolean;
  isMintDeleted: (mintUrl: string) => boolean;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  mintInfoByUrl: Map<string, CashuTokenMetaRow>;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  receiveCashuToken: ReceiveCashuToken | null;
  refreshMintInfo: (mintUrl: string) => Promise<void>;
  rememberCashuTokenKnown: (...tokens: readonly string[]) => void;
  setCashuDraft: React.Dispatch<React.SetStateAction<string>>;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  t: Translate;
  touchMintInfo: (mintUrl: string, nowSec: number) => void;
}

const navigateAfterSave = (options?: SaveCashuFromTextOptions): void => {
  if (options?.navigateToTokens) {
    navigateTo({ route: "cashuTokens" });
  } else if (options?.navigateToWallet) {
    navigateTo({ route: "wallet" });
  }
};

/**
 * The receive vertical: pasted, scanned, and message-borne tokens are
 * accepted through linkshu Receive, which owns parse/dedup/swap/persist and
 * the row lifecycle. This hook only wraps it with app concerns — statuses,
 * payment-history events, mint bookkeeping, and navigation.
 */
export const useSaveCashuFromText = ({
  allowTestMints,
  enqueueCashuOp,
  findContact,
  formatDisplayedAmountParts,
  isCashuTokenStored,
  isMintDeleted,
  logPaymentEvent,
  mintInfoByUrl,
  receiveCashuToken,
  refreshMintInfo,
  rememberCashuTokenKnown,
  setCashuDraft,
  setCashuIsBusy,
  setStatus,
  showPaidOverlay,
  t,
  touchMintInfo,
}: UseSaveCashuFromTextParams) => {
  return React.useCallback(
    async (tokenText: string, options?: SaveCashuFromTextOptions) => {
      const automatic = options?.automatic === true;
      const report = (status: string): void => {
        if (!automatic) setStatus(status);
      };
      const tokenRaw = tokenText.trim();
      if (!tokenRaw) {
        report(t("pasteEmpty"));
        return;
      }
      if (isCashuTokenStored(tokenRaw)) {
        report(t("cashuExists"));
        options?.onResolved?.("terminal");
        navigateAfterSave(options);
        return;
      }
      if (receiveCashuToken === null) {
        report(`${t("errorPrefix")}: Cashu storage is not ready`);
        options?.onResolved?.("transient");
        return;
      }
      // Best-effort metadata so failures still log mint/amount context.
      const parsed = parseTokenText(tokenRaw);
      const parsedMint = parsed?.mint ?? null;
      const parsedAmount = parsed?.amount ?? null;
      const optionContactId = (options?.contactId ?? "").trim();
      const unknownContactId = isUnknownContactId(optionContactId)
        ? optionContactId
        : null;
      const paymentContactId = unknownContactId
        ? null
        : optionContactId || null;

      const eventDetails = {
        rawToken: tokenRaw,
        ...(unknownContactId ? { unknownContactId } : {}),
        ...(options?.requestId ? { requestId: options.requestId } : {}),
      };
      const logFailure = (message: string): void => {
        logPaymentEvent({
          direction: "in",
          status: "error",
          amount: parsedAmount,
          contactId: paymentContactId,
          details: eventDetails,
          fee: null,
          mint: parsedMint,
          unit: null,
          error: message,
          method: "cashu_receive",
          phase: "receive",
        });
      };

      if (isHiddenTestMint(parsedMint, allowTestMints)) {
        const message = t("cashuTestMintRejected");
        report(message);
        logFailure(message);
        options?.onResolved?.("terminal");
        return;
      }

      if (!automatic) setCashuDraft("");
      report(t("cashuAccepting"));
      const restoreDraftForRetry = (): void => {
        if (!automatic) setCashuDraft((draft) => draft || tokenRaw);
      };

      await enqueueCashuOp(async () => {
        setCashuIsBusy(true);
        try {
          const outcome = await receiveCashuToken(tokenRaw, { automatic });

          if (Either.isLeft(outcome)) {
            const error = outcome.left;
            // The caller uses this to stop (or keep) auto-retrying the message
            // that carried the token. A deferred token stays open: when
            // linkshu's retry fails at the swap, receiving the text again
            // resumes that receive.
            const isTerminal =
              error._tag !== "ReceiveDeferred" &&
              !isTransientCashuErrorTag(error._tag);
            options?.onResolved?.(isTerminal ? "terminal" : "transient");
            if (error._tag === "TokenAlreadyKnown") {
              report(t("cashuExists"));
              navigateAfterSave(options);
              return;
            }
            if (error._tag === "ReceiveDeferred") {
              report(t("cashuReceiveDeferred"));
              return;
            }
            if (!isTerminal) restoreDraftForRetry();
            const message = describeTaggedCashuError(error) ?? error._tag;
            const isLogged =
              !automatic || (isTerminal && error._tag !== "TokenAlreadySpent");
            if (isLogged) logFailure(message);
            report(`${t("cashuAcceptFailed")}: ${message}`);
            return;
          }

          const receipt = outcome.right;
          rememberCashuTokenKnown(tokenRaw, receipt.tokenText);
          options?.onResolved?.("terminal");

          touchReceivingMint(receipt.mint, {
            isMintDeleted,
            mintInfoByUrl,
            refreshMintInfo,
            touchMintInfo,
          });

          logPaymentEvent({
            direction: "in",
            status: "ok",
            transactionId: transactionIdForOperation(receipt.operationId),
            amount: receipt.amount,
            contactId: paymentContactId,
            details: {
              acceptedToken: receipt.tokenText,
              ...eventDetails,
            },
            fee: null,
            mint: receipt.mint,
            note: readCashuTokenMemo(receipt.tokenText),
            unit: receipt.unit,
            error: null,
            method: "cashu_receive",
            phase: "receive",
          });

          const title =
            receipt.amount > 0
              ? (() => {
                  const displayAmount = formatDisplayedAmountParts(
                    receipt.amount,
                  );
                  return t("paidReceived")
                    .replace(
                      "{amount}",
                      `${displayAmount.approxPrefix}${displayAmount.amountText}`,
                    )
                    .replace("{unit}", displayAmount.unitLabel);
                })()
              : t("cashuAccepted");
          showPaidOverlay(title, {
            direction: "in",
            amountSat: receipt.amount > 0 ? receipt.amount : null,
            contact:
              options?.contactId && findContact
                ? findContact(options.contactId)
                : null,
          });

          navigateAfterSave(options);
        } catch (error) {
          const message = getUnknownErrorMessage(error, "Accept failed");
          if (!automatic) logFailure(message);
          report(`${t("cashuAcceptFailed")}: ${message}`);
          restoreDraftForRetry();
          options?.onResolved?.("transient");
        } finally {
          setCashuIsBusy(false);
        }
      });
    },
    [
      allowTestMints,
      enqueueCashuOp,
      findContact,
      formatDisplayedAmountParts,
      isCashuTokenStored,
      isMintDeleted,
      logPaymentEvent,
      mintInfoByUrl,
      receiveCashuToken,
      refreshMintInfo,
      rememberCashuTokenKnown,
      setCashuDraft,
      setCashuIsBusy,
      setStatus,
      showPaidOverlay,
      t,
      touchMintInfo,
    ],
  );
};
