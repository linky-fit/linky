import { parseMintUrl } from "@linky/linkshu";
import type { MintUrl } from "@linky/linkshu";
import React from "react";
import { MAIN_MINT_URL } from "../../../utils/mint";
import type { LoggedPaymentEventParams } from "../../types/appTypes";
import type {
  ReclaimCashuTokens,
  RestoreCashuTokens,
} from "../composition/useLinkshuComposition";
import type { Translate } from "../../../i18n";

interface UseRestoreMissingTokensParams {
  cashuIsBusy: boolean;
  /**
   * Every mint the wallet ever held funds at, including mints of legacy
   * rows the user soft-deleted: deleting a mint's last token locally must
   * not exclude that mint from a seed recovery.
   */
  walletMints: readonly string[];
  defaultMintUrl: string | null;
  enqueueCashuOp: (op: () => Promise<void>) => Promise<void>;
  isMintDeleted: (mintUrl: string) => boolean;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  mintInfoDeduped: readonly { canonicalUrl?: string | null }[];
  pushToast: (message: string) => void;
  readSeenMintsFromStorage: () => string[];
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
  /** Null until the linkshu runtime is composed (seed + owners resolved). */
  restoreCashuTokens: RestoreCashuTokens | null;
  reclaimCashuTokens: ReclaimCashuTokens | null;
  setCashuIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setTokensRestoreIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
  t: Translate;
  tokensRestoreIsBusy: boolean;
}

/**
 * NUT-09 restore-from-seed over linkshu `Restore`: scanning, dedup against
 * stored secrets, persistence, and cursor/counter advancement are
 * package-owned. The app decides *which* mints to scan, because it knows
 * more candidates than the package's stored rows — soft-deleted rows, the
 * mint list, the default and main mints, and every mint ever seen — which is
 * what makes restore work on a fresh device with an empty store.
 */
export const useRestoreMissingTokens = ({
  cashuIsBusy,
  walletMints,
  defaultMintUrl,
  enqueueCashuOp,
  isMintDeleted,
  logPaymentEvent,
  mintInfoDeduped,
  pushToast,
  readSeenMintsFromStorage,
  rememberSeenMint,
  restoreCashuTokens,
  reclaimCashuTokens,
  setCashuIsBusy,
  setTokensRestoreIsBusy,
  t,
  tokensRestoreIsBusy,
}: UseRestoreMissingTokensParams) => {
  const running = React.useRef(false);
  return React.useCallback(
    async (mode: "missing" | "reclaim" | "all" = "missing") => {
      if (running.current) return;
      if (tokensRestoreIsBusy) return;
      if (cashuIsBusy) return;

      running.current = true;
      try {
        await enqueueCashuOp(async () => {
          setTokensRestoreIsBusy(mode === "missing");
          setCashuIsBusy(true);

          try {
            if (
              restoreCashuTokens === null ||
              (mode !== "missing" && reclaimCashuTokens === null)
            ) {
              pushToast(t("seedMissing"));
              return;
            }

            const candidates = new Set<MintUrl>();
            for (const candidate of walletMints) {
              const mint = parseMintUrl(candidate);
              if (mint !== null) candidates.add(mint);
            }
            for (const info of mintInfoDeduped) {
              const mint = parseMintUrl(info.canonicalUrl ?? "");
              if (mint !== null) candidates.add(mint);
            }
            for (const seen of readSeenMintsFromStorage()) {
              const mint = parseMintUrl(seen);
              if (mint !== null) candidates.add(mint);
            }
            rememberSeenMint(MAIN_MINT_URL);

            const alwaysInclude = new Set(
              [MAIN_MINT_URL, defaultMintUrl ?? ""].flatMap((url) => {
                const mint = parseMintUrl(url);
                return mint === null ? [] : [mint];
              }),
            );
            for (const mint of alwaysInclude) candidates.add(mint);

            const mints = [...candidates].filter(
              (mint) => alwaysInclude.has(mint) || !isMintDeleted(mint),
            );
            if (mints.length === 0) {
              pushToast(t("restoreNothing"));
              return;
            }

            if (mode !== "missing" && reclaimCashuTokens !== null) {
              const result = await reclaimCashuTokens(
                mode === "all" ? mints : undefined,
              );
              const report = result.reclaim;
              const incomplete =
                report.unresolvedProofs.length > 0 ||
                (result.restore?.unavailableMints.length ?? 0) > 0;
              pushToast(
                t(incomplete ? "cashuReclaimIncomplete" : "cashuReclaimDone")
                  .replace("{amount}", String(report.reclaimedAmount))
                  .replace("{proofs}", String(report.reclaimedProofs.length)),
              );
              return;
            }

            const { restore, reclaim } = await restoreCashuTokens(mints);
            const incomplete =
              restore.unavailableMints.length > 0 ||
              reclaim.unresolvedProofs.length > 0;

            if (reclaim.reclaimedAmount > 0) {
              logPaymentEvent({
                direction: "in",
                status: "ok",
                amount: reclaim.reclaimedAmount,
                fee: null,
                mint: null,
                unit: "sat",
                error: null,
                contactId: null,
                method: "cashu_restore",
                phase: "restore",
                details: { scannedMints: [...restore.scannedMints] },
              });
            }
            pushToast(
              t(
                incomplete
                  ? "cashuMissingRestoreIncomplete"
                  : restore.restoredProofs === 0
                    ? "restoreNothing"
                    : "cashuMissingRestoreDone",
              ).replace("{amount}", String(reclaim.reclaimedAmount)),
            );
          } catch (e) {
            pushToast(`${t("restoreFailed")}: ${String(e ?? "unknown")}`);
          } finally {
            setCashuIsBusy(false);
            setTokensRestoreIsBusy(false);
          }
        });
      } finally {
        running.current = false;
      }
    },
    [
      cashuIsBusy,
      walletMints,
      defaultMintUrl,
      enqueueCashuOp,
      isMintDeleted,
      logPaymentEvent,
      mintInfoDeduped,
      pushToast,
      readSeenMintsFromStorage,
      rememberSeenMint,
      restoreCashuTokens,
      reclaimCashuTokens,
      setCashuIsBusy,
      setTokensRestoreIsBusy,
      t,
      tokensRestoreIsBusy,
    ],
  );
};
