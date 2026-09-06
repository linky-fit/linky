import { parseMintUrl, parseTokenText } from "@linky/linkshu";
import type { MintUrl } from "@linky/linkshu";
import React from "react";
import type { CashuTokenRow } from "../../../evolu";
import { MAIN_MINT_URL } from "../../../utils/mint";
import type { LoggedPaymentEventParams } from "../../types/appTypes";
import type { RestoreCashuTokens } from "../composition/useLinkshuComposition";
import type { Translate } from "../../../i18n";

interface UseRestoreMissingTokensParams {
  cashuIsBusy: boolean;
  cashuTokensAll: readonly CashuTokenRow[];
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
  cashuTokensAll,
  defaultMintUrl,
  enqueueCashuOp,
  isMintDeleted,
  logPaymentEvent,
  mintInfoDeduped,
  pushToast,
  readSeenMintsFromStorage,
  rememberSeenMint,
  restoreCashuTokens,
  setCashuIsBusy,
  setTokensRestoreIsBusy,
  t,
  tokensRestoreIsBusy,
}: UseRestoreMissingTokensParams) => {
  return React.useCallback(async () => {
    if (tokensRestoreIsBusy) return;
    if (cashuIsBusy) return;

    await enqueueCashuOp(async () => {
      setTokensRestoreIsBusy(true);
      setCashuIsBusy(true);

      try {
        if (restoreCashuTokens === null) {
          pushToast(t("seedMissing"));
          return;
        }

        // Soft-deleted rows count: the user deleting a mint's last token
        // locally must not exclude that mint from a seed recovery.
        const candidates = new Set<MintUrl>();
        for (const row of cashuTokensAll) {
          const fromColumn = parseMintUrl(row.mint ?? "");
          if (fromColumn !== null) {
            candidates.add(fromColumn);
            continue;
          }
          const tokenText = (row.token ?? row.rawToken ?? "").trim();
          const mint = tokenText ? parseTokenText(tokenText)?.mint : null;
          if (mint != null) candidates.add(mint);
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

        const report = await restoreCashuTokens(mints);

        if (report.rows.length === 0) {
          pushToast(t("restoreNothing"));
          return;
        }

        logPaymentEvent({
          direction: "in",
          status: "ok",
          amount: report.restoredAmount,
          fee: null,
          mint: null,
          unit: "sat",
          error: null,
          contactId: null,
          method: "cashu_restore",
          phase: "restore",
          details: { scannedMints: [...report.scannedMints] },
        });

        pushToast(
          t("restoreDone")
            .replace("{amount}", String(report.restoredAmount))
            .replace("{tokens}", String(report.rows.length)),
        );
      } catch (e) {
        pushToast(`${t("restoreFailed")}: ${String(e ?? "unknown")}`);
      } finally {
        setCashuIsBusy(false);
        setTokensRestoreIsBusy(false);
      }
    });
  }, [
    cashuIsBusy,
    cashuTokensAll,
    defaultMintUrl,
    enqueueCashuOp,
    isMintDeleted,
    logPaymentEvent,
    mintInfoDeduped,
    pushToast,
    readSeenMintsFromStorage,
    rememberSeenMint,
    restoreCashuTokens,
    setCashuIsBusy,
    setTokensRestoreIsBusy,
    t,
    tokensRestoreIsBusy,
  ]);
};
