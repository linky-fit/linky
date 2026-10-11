import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import type {
  OperationId,
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
import { MAIN_MINT_URL } from "../../../utils/mint";
import { isIssuedTransfer } from "../../lib/cashuTransfers";
import { linkshuCommandsAtom } from "../../state/linkshu/commands";
import { walletOpRunningAtom } from "../../state/wallet/opQueue";
import type { ChatWrites } from "../../state/wallet/payments";
import {
  issueTokenAmountAtom,
  tokenBulkCheckBusyAtom,
  tokenContactPickAtom,
  tokenRecoveryAtom,
  tokenRunGuardsAtom,
} from "../../state/wallet/tokenActivity";
import {
  restoreCandidates,
  tokensCommandsAtom,
  type RecoverMode,
  type TransferUpdateOutcome,
} from "../../state/wallet/tokens";
import type { ContactIdentityRowLike } from "../../types/appTypes";
import {
  useDisplayAmounts,
  usePushToast,
  useSetStatus,
  useTranslation,
} from "../shell";
import { useWalletBalance } from "./useWalletInventory";

const ISSUED_CHECK_INTERVAL_MS = 60_000;

const useTokensCommands = () =>
  Option.getOrNull(AsyncResult.value(useAtomValue(tokensCommandsAtom)));

/** Asks the mints for the state of proofs (NUT-07); null until the linkshu runtime is up. */
export const useInspectCashuProofStates = () =>
  Option.getOrNull(AsyncResult.value(useAtomValue(linkshuCommandsAtom)))
    ?.inspectCashuProofStates ?? null;

/** True while any token screen should refuse new work. */
const useTokenWorkBusy = () => {
  const walletOpRunning = useAtomValue(walletOpRunningAtom);
  const bulkCheckBusy = useAtomValue(tokenBulkCheckBusyAtom);
  const recovery = useAtomValue(tokenRecoveryAtom);
  return walletOpRunning || bulkCheckBusy || recovery.busy;
};

const useTransferFailureStatus = () => {
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const reportUpdateFailure = React.useCallback(
    (outcome: Exclude<TransferUpdateOutcome, { _tag: "Done" }>) =>
      setStatus(`${t("errorPrefix")}: ${outcome.detail}`),
    [setStatus, t],
  );
  const notReady = React.useCallback(
    () => setStatus(`${t("errorPrefix")}: Cashu storage is not ready`),
    [setStatus, t],
  );
  return { notReady, reportUpdateFailure };
};

const useCheckIssuedTokenClaims = () => {
  const commands = useTokensCommands();
  return React.useCallback(
    () =>
      commands === null
        ? Promise.resolve({ claimed: [] })
        : commands.checkIssuedClaims(),
    [commands],
  );
};

const useReturnTokenToWallet = () => {
  const commands = useTokensCommands();
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const { notReady, reportUpdateFailure } = useTransferFailureStatus();
  return React.useCallback(
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
};

/**
 * Issued tokens and transfers on the token screens: issuing, NUT-07
 * checks, claims of issued tokens, reclaims and transfer updates, mapped to
 * statuses, toasts and navigation.
 */
export const useWalletTokens = () => {
  const commands = useTokensCommands();
  const { t } = useTranslation();
  const setStatus = useSetStatus();
  const pushToast = usePushToast();
  const { notReady, reportUpdateFailure } = useTransferFailureStatus();
  const checkIssuedCashuTokensAndDeleteClaimed = useCheckIssuedTokenClaims();
  const returnCashuTokenToWallet = useReturnTokenToWallet();
  const { cashuBalance } = useWalletBalance();
  const walletOpRunning = useAtomValue(walletOpRunningAtom);
  const [cashuEmitAmount, setCashuEmitAmount] = useAtom(issueTokenAmountAtom);
  const [cashuBulkCheckIsBusy, setCashuBulkCheckIsBusy] = useAtom(
    tokenBulkCheckBusyAtom,
  );
  const recovery = useAtomValue(tokenRecoveryAtom);
  const [, setPendingCashuTokenContactPickId] = useAtom(tokenContactPickAtom);
  const guards = useAtomValue(tokenRunGuardsAtom);
  const busy = useTokenWorkBusy();

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
  }, [
    cashuBulkCheckIsBusy,
    commands,
    pushToast,
    setCashuBulkCheckIsBusy,
    setStatus,
    t,
  ]);

  const checkSingleIssuedCashuTokenIsClaimed = React.useCallback(
    async (id: CashuOperationId): Promise<boolean> => {
      const outcome = await checkIssuedCashuTokensAndDeleteClaimed();
      return outcome.claimed.some((entry) => entry.id === id);
    },
    [checkIssuedCashuTokensAndDeleteClaimed],
  );

  const reclaimCashuTransfer = React.useCallback(
    async (id: CashuOperationId) => {
      if (busy || guards.reclaim.isRunning()) return;
      if (commands === null) {
        pushToast(t("seedMissing"));
        return;
      }
      guards.reclaim.enter();
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
        guards.reclaim.leave();
      }
    },
    [busy, commands, guards, pushToast, t],
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
      setCashuEmitAmount,
      setStatus,
      t,
      walletOpRunning,
    ],
  );

  const startSendCashuTokenToContact = React.useCallback(
    async (id: CashuOperationId) => {
      setPendingCashuTokenContactPickId(id);
      setStatus(t("cashuSelectContactToSend"));
      navigateTo({ route: "contacts" });
    },
    [setPendingCashuTokenContactPickId, setStatus, t],
  );

  return {
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
    reclaimCashuTransfer,
    returnCashuTokenToWallet,
    setCashuEmitAmount,
    startSendCashuTokenToContact,
    /** Any token work or wallet operation is running. */
    tokenWorkIsBusy: busy,
    tokensRestoreIsBusy: recovery.busy,
    tokensRestoreProgress: recovery.progress,
  };
};

interface UseIssuedTokenClaimWatchParams {
  walletProofs: ReadonlyArray<StoredProof>;
  walletTransfers: ReadonlyArray<TokenTransfer>;
}

/**
 * Issued-token claims (issue #86): checked on mount and every 60 s while
 * any token is out, so the list cleans up off the token screens too.
 */
export const useIssuedTokenClaimWatch = ({
  walletProofs,
  walletTransfers,
}: UseIssuedTokenClaimWatchParams): void => {
  const checkIssuedCashuTokensAndDeleteClaimed = useCheckIssuedTokenClaims();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const hasIssuedTokens =
    walletTransfers.some(isIssuedTransfer) ||
    walletProofs.some(
      (proof) => proof.state === "handedOut" || proof.state === "externalized",
    );
  // Refs keep the interval alive across callback identity changes.
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
    const intervalId = setInterval(() => void tick(), ISSUED_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [checkIssuedRef, claimToastRef, hasIssuedTokens]);
};

interface UseTokenRecoveryParams {
  allowTestMints: boolean;
  defaultMintUrl: string | null;
  isMintDeleted: (mintUrl: string) => boolean;
  mintInfoDeduped: ReadonlyArray<{ canonicalUrl?: string | null }>;
  readSeenMints: () => string[];
  recoverEnvelopes: () => Promise<void>;
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
  walletMints: ReadonlyArray<string>;
}

/** Recovering tokens from the seed: missing ones, handed-out ones, or both. */
export const useTokenRecovery = ({
  allowTestMints,
  defaultMintUrl,
  isMintDeleted,
  mintInfoDeduped,
  readSeenMints,
  recoverEnvelopes,
  rememberSeenMint,
  walletMints,
}: UseTokenRecoveryParams) => {
  const commands = useTokensCommands();
  const pushToast = usePushToast();
  const { t } = useTranslation();
  const walletOpRunning = useAtomValue(walletOpRunningAtom);
  const [recovery, setRecovery] = useAtom(tokenRecoveryAtom);
  const guards = useAtomValue(tokenRunGuardsAtom);

  const recoverTokens = React.useCallback(
    async (mode: RecoverMode) => {
      if (guards.recover.isRunning() || recovery.busy || walletOpRunning)
        return;
      if (commands === null) {
        pushToast(t("seedMissing"));
        return;
      }
      guards.recover.enter();
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
            onProgress: (progress) =>
              setRecovery((current) => ({ ...current, progress })),
            recoverEnvelopes,
          },
          {
            onStarted: () =>
              setRecovery((current) => ({
                ...current,
                busy: mode === "missing",
              })),
          },
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
        setRecovery({ busy: false, progress: null });
        guards.recover.leave();
      }
    },
    [
      allowTestMints,
      commands,
      defaultMintUrl,
      guards,
      isMintDeleted,
      mintInfoDeduped,
      pushToast,
      readSeenMints,
      recoverEnvelopes,
      recovery.busy,
      rememberSeenMint,
      setRecovery,
      t,
      walletMints,
      walletOpRunning,
    ],
  );

  return {
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
  };
};

interface UseTokenContactSendParams {
  chat: Pick<ChatWrites, "appendLocalNostrMessage" | "updateLocalNostrMessage">;
  walletTransfers: ReadonlyArray<TokenTransfer>;
}

/** Sending an issued token to the contact the user picks after "Send to contact". */
export const useTokenContactSend = ({
  chat,
  walletTransfers,
}: UseTokenContactSendParams) => {
  const commands = useTokensCommands();
  const setStatus = useSetStatus();
  const { t } = useTranslation();
  const returnCashuTokenToWallet = useReturnTokenToWallet();
  const [pendingCashuTokenContactPickId, setPendingCashuTokenContactPickId] =
    useAtom(tokenContactPickAtom);

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
  }, [
    pendingCashuContactSend,
    returnCashuTokenToWallet,
    setPendingCashuTokenContactPickId,
  ]);

  const sendCashuTokenToContact = React.useCallback(
    async (contact: ContactIdentityRowLike, tokenId: CashuOperationId) => {
      setPendingCashuTokenContactPickId(null);
      if (commands === null) {
        setStatus(`${t("errorPrefix")}: Cashu storage is not ready`);
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
    [
      chat,
      commands,
      setPendingCashuTokenContactPickId,
      setStatus,
      t,
      walletTransfers,
    ],
  );

  return {
    cancelPendingCashuContactSend,
    pendingCashuContactSend,
    pendingCashuTokenContactPickId,
    sendCashuTokenToContact,
  };
};
