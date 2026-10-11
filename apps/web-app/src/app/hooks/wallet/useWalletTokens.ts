import { useAtomValue } from "@linky-fit/linkstr-react";
import type {
  OperationId,
  RestoreProgress,
  StoredProof,
  TokenTransfer,
} from "@linky-fit/linkshu";
import { CashuOperationId as CashuOperationIdType } from "@linky-fit/linksync";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import type { CashuOperationId } from "../../../evolu";
import { useLatest } from "../../../hooks/useLatest";
import { navigateTo } from "../../../hooks/useRouting";
import type { Translate } from "../../../i18n";
import { MAIN_MINT_URL } from "../../../utils/mint";
import { isIssuedTransfer } from "../../lib/cashuTransfers";
import {
  restoreCandidates,
  tokensCommandsAtom,
  type RecoverMode,
  type TransferUpdateOutcome,
} from "../../state/wallet/tokens";
import type { ChatWrites } from "../../state/wallet/payments";
import type { ContactIdentityRowLike } from "../../types/appTypes";

interface UseWalletTokensParams {
  allowTestMints: boolean;
  cashuBalance: number;
  chat: Pick<ChatWrites, "appendLocalNostrMessage" | "updateLocalNostrMessage">;
  defaultMintUrl: string | null;
  formatDisplayedAmountText: (amountSat: number) => string;
  isMintDeleted: (mintUrl: string) => boolean;
  mintInfoDeduped: ReadonlyArray<{ canonicalUrl?: string | null }>;
  pushToast: (message: string) => void;
  readSeenMints: () => string[];
  recoverEnvelopes: () => Promise<void>;
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  walletMints: ReadonlyArray<string>;
  walletOpRunning: boolean;
  walletProofs: ReadonlyArray<StoredProof>;
  walletTransfers: ReadonlyArray<TokenTransfer>;
}

const ISSUED_CHECK_INTERVAL_MS = 60_000;

/**
 * Issued tokens and transfers on the token pages: issuing, NUT-07 checks,
 * claims of issued tokens, sending one to a contact, reclaims, recovery from
 * the seed and transfer updates, mapped to statuses, toasts and navigation.
 */
export const useWalletTokens = ({
  allowTestMints,
  cashuBalance,
  chat,
  defaultMintUrl,
  formatDisplayedAmountText,
  isMintDeleted,
  mintInfoDeduped,
  pushToast,
  readSeenMints,
  recoverEnvelopes,
  rememberSeenMint,
  setStatus,
  t,
  walletMints,
  walletOpRunning,
  walletProofs,
  walletTransfers,
}: UseWalletTokensParams) => {
  const commands = Option.getOrNull(
    AsyncResult.value(useAtomValue(tokensCommandsAtom)),
  );
  const [cashuEmitAmount, setCashuEmitAmount] = React.useState("");
  const [cashuBulkCheckIsBusy, setCashuBulkCheckIsBusy] = React.useState(false);
  const [tokensRestoreIsBusy, setTokensRestoreIsBusy] = React.useState(false);
  const [tokensRestoreProgress, setTokensRestoreProgress] =
    React.useState<RestoreProgress | null>(null);
  const [pendingCashuTokenContactPickId, setPendingCashuTokenContactPickId] =
    React.useState<CashuOperationId | null>(null);
  const reclaimRunningRef = React.useRef(false);
  const recoverRunningRef = React.useRef(false);

  const reportUpdateFailure = React.useCallback(
    (outcome: Exclude<TransferUpdateOutcome, { _tag: "Done" }>) =>
      setStatus(`${t("errorPrefix")}: ${outcome.detail}`),
    [setStatus, t],
  );
  const notReady = React.useCallback(
    () => setStatus(`${t("errorPrefix")}: Cashu storage is not ready`),
    [setStatus, t],
  );

  /** True once the transfer moved; a failure shows as the status. */
  const updateTransfer = React.useCallback(
    async (
      update: "forget" | "markExternalized" | "markIssued",
      id: CashuOperationId,
    ): Promise<boolean> => {
      if (commands === null) {
        notReady();
        return false;
      }
      const outcome = await commands[update](id);
      if (outcome._tag === "Done") return true;
      reportUpdateFailure(outcome);
      return false;
    },
    [commands, notReady, reportUpdateFailure],
  );

  const markCashuTokenIssued = React.useCallback(
    (id: CashuOperationId) => updateTransfer("markIssued", id),
    [updateTransfer],
  );
  const markCashuTokenExternalized = React.useCallback(
    (id: CashuOperationId) => updateTransfer("markExternalized", id),
    [updateTransfer],
  );

  const returnCashuTokenToWallet = React.useCallback(
    async (id: CashuOperationId) => {
      if (commands === null) {
        notReady();
        return;
      }
      const outcome = await commands.returnToWallet(id);
      if (outcome._tag === "Done") setStatus(t("cashuReturnedToWallet"));
      else reportUpdateFailure(outcome);
    },
    [commands, notReady, reportUpdateFailure, setStatus, t],
  );

  /** Gives up on a token waiting for its mint; lost unless its text was kept. */
  const discardCashuDeferredReceive = React.useCallback(
    async (id: OperationId): Promise<void> => {
      if (commands === null) {
        notReady();
        return;
      }
      const outcome = await commands.forget(id);
      switch (outcome._tag) {
        case "Done":
          setStatus(t("cashuDeferredReceiveDiscarded"));
          return;
        case "InvalidTransition":
          setStatus(t("cashuDeferredAlreadyReceiving"));
          return;
        case "Failed":
          reportUpdateFailure(outcome);
          return;
      }
    },
    [commands, notReady, reportUpdateFailure, setStatus, t],
  );

  const deleteCashuToken = React.useCallback(
    async (id: CashuOperationId) => {
      if (commands === null) {
        pushToast(t("errorPrefix"));
        return;
      }
      const outcome = await commands.forget(id);
      if (outcome._tag !== "Done") {
        reportUpdateFailure(outcome);
        return;
      }
      setStatus(t("cashuDeleted"));
      navigateTo({ route: "wallet" });
    },
    [commands, pushToast, reportUpdateFailure, setStatus, t],
  );

  const checkAndRefreshCashuToken = React.useCallback(
    async (
      id: CashuOperationId,
    ): Promise<"ok" | "invalid" | "transient" | "skipped"> => {
      if (commands === null) {
        pushToast(t("errorPrefix"));
        return "skipped";
      }
      const outcome = await commands.checkToken(id, {
        onStarted: () => setStatus(t("cashuChecking")),
      });
      switch (outcome._tag) {
        case "Live":
          setStatus(null);
          pushToast(t("cashuCheckOk"));
          return "ok";
        case "Spent":
          setStatus(t("cashuInvalid"));
          pushToast(t("cashuInvalid"));
          return "invalid";
        case "Unavailable":
          setStatus(t("cashuCheckFailed"));
          pushToast(t("cashuCheckFailed"));
          return "transient";
        case "Unknown":
          pushToast(t("errorPrefix"));
          return "skipped";
        case "Busy":
          return "skipped";
      }
    },
    [commands, pushToast, setStatus, t],
  );

  const checkAllCashuTokensAndDeleteInvalid = React.useCallback(async () => {
    if (commands === null || cashuBulkCheckIsBusy) return;
    setCashuBulkCheckIsBusy(true);
    try {
      const outcome = await commands.checkAllTokens({
        onStarted: () => setStatus(t("cashuChecking")),
      });
      if (outcome._tag === "Busy") return;
      setStatus(null);
      const { report } = outcome;
      pushToast(
        report.markedSpent.length > 0
          ? t("cashuInvalid")
          : report.unavailableMints.length > 0
            ? t("cashuCheckFailed")
            : t("cashuCheckOk"),
      );
    } finally {
      setCashuBulkCheckIsBusy(false);
    }
  }, [cashuBulkCheckIsBusy, commands, pushToast, setStatus, t]);

  const checkIssuedCashuTokensAndDeleteClaimed = React.useCallback(
    () =>
      commands === null
        ? Promise.resolve({ claimed: [] })
        : commands.checkIssuedClaims(),
    [commands],
  );

  const checkSingleIssuedCashuTokenIsClaimed = React.useCallback(
    async (id: CashuOperationId): Promise<boolean> => {
      const outcome = await checkIssuedCashuTokensAndDeleteClaimed();
      return outcome.claimed.some((entry) => entry.id === id);
    },
    [checkIssuedCashuTokensAndDeleteClaimed],
  );

  // Issued-token claims (issue #86): checked on mount and every 60 s while
  // any token is out, so the list cleans up off the token pages too. Refs
  // keep the interval alive across callback identity changes.
  const hasIssuedTokens =
    walletTransfers.some(isIssuedTransfer) ||
    walletProofs.some(
      (proof) => proof.state === "handedOut" || proof.state === "externalized",
    );
  const checkIssuedRef = useLatest(checkIssuedCashuTokensAndDeleteClaimed);
  const claimToastRef = useLatest({ formatDisplayedAmountText, pushToast, t });
  React.useEffect(() => {
    if (!hasIssuedTokens) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const outcome = await checkIssuedRef.current();
        if (cancelled) return;
        const toast = claimToastRef.current;
        for (const entry of outcome.claimed) {
          toast.pushToast(
            entry.amount > 0
              ? toast
                  .t("cashuTokenClaimedWithAmount")
                  .replace(
                    "{amount}",
                    toast.formatDisplayedAmountText(entry.amount),
                  )
              : toast.t("cashuTokenClaimed"),
          );
        }
      } catch {
        // A mint that did not answer is checked again on the next tick.
      }
    };
    void tick();
    const intervalId = setInterval(
      () => void tick(),
      ISSUED_CHECK_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [checkIssuedRef, claimToastRef, hasIssuedTokens]);

  const reclaimCashuTransfer = React.useCallback(
    async (id: CashuOperationId) => {
      const busy =
        walletOpRunning || cashuBulkCheckIsBusy || tokensRestoreIsBusy;
      if (busy || reclaimRunningRef.current) return;
      if (commands === null) {
        pushToast(t("seedMissing"));
        return;
      }
      reclaimRunningRef.current = true;
      try {
        const outcome = await commands.reclaimTransfer(id);
        if (outcome._tag === "Failed") {
          pushToast(`${t("errorPrefix")}: ${outcome.detail}`);
          return;
        }
        const { report } = outcome;
        const message =
          report.unresolvedProofs.length > 0
            ? "cashuReclaimIncomplete"
            : report.reclaimedProofs.length > 0
              ? "cashuReclaimDone"
              : report.spentProofs.length > 0
                ? "cashuTokenClaimed"
                : "cashuNoProofs";
        pushToast(
          t(message)
            .replace("{amount}", String(report.reclaimedAmount))
            .replace("{proofs}", String(report.reclaimedProofs.length)),
        );
      } finally {
        reclaimRunningRef.current = false;
      }
    },
    [
      cashuBulkCheckIsBusy,
      commands,
      pushToast,
      t,
      tokensRestoreIsBusy,
      walletOpRunning,
    ],
  );

  const recoverTokens = React.useCallback(
    async (mode: RecoverMode) => {
      if (recoverRunningRef.current || tokensRestoreIsBusy || walletOpRunning)
        return;
      if (commands === null) {
        pushToast(t("seedMissing"));
        return;
      }
      recoverRunningRef.current = true;
      try {
        rememberSeenMint(MAIN_MINT_URL);
        const mints = restoreCandidates({
          allowTestMints,
          defaultMint: defaultMintUrl,
          isMintDeleted,
          knownMints: [
            ...walletMints,
            ...mintInfoDeduped.map((info) => info.canonicalUrl ?? ""),
            ...readSeenMints(),
          ],
        });
        const outcome = await commands.recoverTokens(
          {
            mode,
            mints,
            onProgress: setTokensRestoreProgress,
            recoverEnvelopes,
          },
          { onStarted: () => setTokensRestoreIsBusy(mode === "missing") },
        );
        switch (outcome._tag) {
          case "NothingToScan":
            pushToast(t("restoreNothing"));
            return;
          case "Reclaimed":
            pushToast(
              t(
                outcome.incomplete
                  ? "cashuReclaimIncomplete"
                  : "cashuReclaimDone",
              )
                .replace("{amount}", String(outcome.report.reclaimedAmount))
                .replace(
                  "{proofs}",
                  String(outcome.report.reclaimedProofs.length),
                ),
            );
            return;
          case "Restored":
            pushToast(
              t(
                outcome.incomplete
                  ? "cashuMissingRestoreIncomplete"
                  : outcome.restore.restoredProofs === 0
                    ? "restoreNothing"
                    : "cashuMissingRestoreDone",
              ).replace("{amount}", String(outcome.reclaim.reclaimedAmount)),
            );
            return;
          case "Failed":
            pushToast(`${t("restoreFailed")}: ${outcome.detail}`);
            return;
        }
      } finally {
        setTokensRestoreIsBusy(false);
        setTokensRestoreProgress(null);
        recoverRunningRef.current = false;
      }
    },
    [
      allowTestMints,
      commands,
      defaultMintUrl,
      isMintDeleted,
      mintInfoDeduped,
      pushToast,
      readSeenMints,
      recoverEnvelopes,
      rememberSeenMint,
      t,
      tokensRestoreIsBusy,
      walletMints,
      walletOpRunning,
    ],
  );

  const emitCashuToken = React.useCallback(
    async (options?: { note?: string | null }) => {
      const memo = (options?.note ?? "").trim() || null;
      const amountSat = Number.parseInt(cashuEmitAmount.trim(), 10);
      if (!Number.isFinite(amountSat) || amountSat <= 0) {
        setStatus(t("payInvalidAmount"));
        return;
      }
      if (walletOpRunning) return;
      if (cashuBalance < amountSat) {
        setStatus(t("payInsufficient"));
        return;
      }
      if (commands === null) {
        notReady();
        return;
      }
      const outcome = await commands.issueToken(
        { amountSat, memo },
        { onStarted: () => setStatus(t("cashuEmitting")) },
      );
      switch (outcome._tag) {
        case "Issued": {
          setCashuEmitAmount("");
          setStatus(null);
          const routeId = CashuOperationIdType.fromUnknown(
            outcome.receipt.operationId,
          );
          navigateTo(
            routeId.ok
              ? { route: "cashuToken", id: routeId.value }
              : { route: "cashuTokens" },
          );
          return;
        }
        case "Insufficient":
          setStatus(t("payInsufficient"));
          return;
        case "Failed":
          setStatus(
            outcome.insufficient
              ? t("payInsufficient")
              : `${t("payFailed")}: ${outcome.detail}`,
          );
          return;
        case "Busy":
          return;
      }
    },
    [
      cashuBalance,
      cashuEmitAmount,
      commands,
      notReady,
      setStatus,
      t,
      walletOpRunning,
    ],
  );

  const pendingCashuContactSend = React.useMemo(() => {
    if (!pendingCashuTokenContactPickId) return null;
    const transfer = walletTransfers.find(
      (candidate) =>
        String(candidate.id) === pendingCashuTokenContactPickId &&
        isIssuedTransfer(candidate),
    );
    return transfer
      ? { amountSat: transfer.amount, tokenId: pendingCashuTokenContactPickId }
      : null;
  }, [pendingCashuTokenContactPickId, walletTransfers]);

  const cancelPendingCashuContactSend = React.useCallback(async () => {
    const tokenId = pendingCashuContactSend?.tokenId ?? null;
    setPendingCashuTokenContactPickId(null);
    if (tokenId) await returnCashuTokenToWallet(tokenId);
  }, [pendingCashuContactSend, returnCashuTokenToWallet]);

  const startSendCashuTokenToContact = React.useCallback(
    async (id: CashuOperationId) => {
      setPendingCashuTokenContactPickId(id);
      setStatus(t("cashuSelectContactToSend"));
      navigateTo({ route: "contacts" });
    },
    [setStatus, t],
  );

  const sendCashuTokenToContact = React.useCallback(
    async (contact: ContactIdentityRowLike, tokenId: CashuOperationId) => {
      setPendingCashuTokenContactPickId(null);
      if (commands === null) {
        notReady();
        return;
      }
      const transfer =
        walletTransfers.find(
          (candidate) =>
            String(candidate.id) === tokenId && isIssuedTransfer(candidate),
        ) ?? null;
      const contactId = (contact.id ?? "").trim();
      const outcome = await commands.sendIssuedToken(
        {
          transfer,
          contact,
          onClosed: () => navigateTo({ route: "chat", id: contactId }),
        },
        chat,
      );
      switch (outcome._tag) {
        case "Sent":
          return;
        case "Queued":
          setStatus(t("chatQueued"));
          return;
        case "InvalidToken":
          setStatus(t("cashuInvalid"));
          return;
        case "ContactNotFound":
          setStatus(t("contactNotFound"));
          return;
        case "MissingIdentity":
          setStatus(t("profileMissingNpub"));
          return;
        case "MissingContactNpub":
          setStatus(t("chatMissingContactNpub"));
          return;
        case "NotClosed":
        case "Failed":
          setStatus(`${t("errorPrefix")}: ${outcome.detail}`);
          return;
      }
    },
    [chat, commands, notReady, setStatus, t, walletTransfers],
  );

  return {
    cancelPendingCashuContactSend,
    cashuBulkCheckIsBusy,
    cashuEmitAmount,
    checkAllCashuTokensAndDeleteInvalid,
    checkAndRefreshCashuToken,
    checkIssuedCashuTokensAndDeleteClaimed,
    checkSingleIssuedCashuTokenIsClaimed,
    deleteCashuToken,
    discardCashuDeferredReceive,
    emitCashuToken,
    markCashuTokenExternalized,
    markCashuTokenIssued,
    pendingCashuContactSend,
    pendingCashuTokenContactPickId,
    reclaimCashuTransfer,
    reclaimHandedOutTokens: React.useCallback(
      () => recoverTokens("reclaim"),
      [recoverTokens],
    ),
    restoreAndReclaimAllTokens: React.useCallback(
      () => recoverTokens("all"),
      [recoverTokens],
    ),
    restoreMissingTokens: React.useCallback(
      () => recoverTokens("missing"),
      [recoverTokens],
    ),
    returnCashuTokenToWallet,
    sendCashuTokenToContact,
    setCashuEmitAmount,
    startSendCashuTokenToContact,
    tokensRestoreIsBusy,
    tokensRestoreProgress,
  };
};
