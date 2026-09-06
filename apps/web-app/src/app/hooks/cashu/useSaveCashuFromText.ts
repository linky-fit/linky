import { Either } from "effect";
import React from "react";
import { parseTokenText } from "@linky/linkshu";
import { navigateTo } from "../../../hooks/useRouting";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import type { LoggedPaymentEventParams } from "../../types/appTypes";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { isUnknownContactId } from "../messages/contactIdentity";
import type { ReceiveCashuToken } from "../composition/useLinkshuComposition";
import { nowSeconds } from "../../../utils/time";
import type { Translate } from "../../../i18n";

interface CashuTokenMetaRow {
  id: string;
  isDeleted?: string | number | boolean | null | undefined;
  lastCheckedAtSec?: number | null | undefined;
}

interface SaveCashuFromTextOptions {
  contactId?: string;
  navigateToTokens?: boolean;
  navigateToWallet?: boolean;
  requestId?: string;
}

interface UseSaveCashuFromTextParams {
  enqueueCashuOp: (op: () => Promise<void>) => Promise<void>;
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
  showPaidOverlay: (title?: string) => void;
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
  enqueueCashuOp,
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
      const tokenRaw = tokenText.trim();
      if (!tokenRaw) {
        setStatus(t("pasteEmpty"));
        return;
      }
      if (isCashuTokenStored(tokenRaw)) {
        setStatus(t("cashuExists"));
        navigateAfterSave(options);
        return;
      }
      if (receiveCashuToken === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
        return;
      }
      setCashuDraft("");
      setStatus(t("cashuAccepting"));

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

      await enqueueCashuOp(async () => {
        setCashuIsBusy(true);
        try {
          const outcome = await receiveCashuToken(tokenRaw);

          if (Either.isLeft(outcome)) {
            const error = outcome.left;
            if (error._tag === "TokenAlreadyKnown") {
              setStatus(t("cashuExists"));
              navigateAfterSave(options);
              return;
            }
            const message = describeTaggedCashuError(error) ?? error._tag;
            logFailure(message);
            setStatus(`${t("cashuAcceptFailed")}: ${message}`);
            return;
          }

          const receipt = outcome.right;
          rememberCashuTokenKnown(tokenRaw, receipt.tokenText);

          const cleanedMint = receipt.mint.trim().replace(/\/+$/, "");
          if (cleanedMint && !isMintDeleted(cleanedMint)) {
            const nowSec = nowSeconds();
            const existing = mintInfoByUrl.get(cleanedMint);
            touchMintInfo(cleanedMint, nowSec);

            const lastChecked = (existing?.lastCheckedAtSec ?? 0) || 0;
            if (existing && !lastChecked) void refreshMintInfo(cleanedMint);
          }

          logPaymentEvent({
            direction: "in",
            status: "ok",
            amount: receipt.amount,
            contactId: paymentContactId,
            details: {
              acceptedToken: receipt.tokenText,
              ...eventDetails,
            },
            fee: null,
            mint: receipt.mint,
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
          showPaidOverlay(title);

          navigateAfterSave(options);
        } catch (error) {
          const message = getUnknownErrorMessage(error, "Accept failed");
          logFailure(message);
          setStatus(`${t("cashuAcceptFailed")}: ${message}`);
        } finally {
          setCashuIsBusy(false);
        }
      });
    },
    [
      enqueueCashuOp,
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
