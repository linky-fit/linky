import {
  RegistryContext,
  useAtomSuspense,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import type { StoredProof } from "@linky-fit/linkshu";
import { Option, Result } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import { useDeferredOnlineReady } from "../../../hooks/useDeferredOnlineReady";
import {
  isHiddenTestMint,
  MAIN_MINT_URL,
  normalizeMintUrl,
  PRESET_MINTS,
  type MintIcon,
} from "../../../utils/mint";
import { nowSeconds } from "../../../utils/time";
import { linkshuCommandsAtom } from "../../state/linkshu/commands";
import { platformAtom } from "../../state/platform";
import {
  deletedMintInfoRows,
  failedMintIconUrlsAtom,
  isMintDeleted,
  mintInfoByUrlAtom,
  mintInfoDedupedAtom,
  mintInfoRefreshesAtom,
  mintInfoRowsAtom,
  mintRuntimeAtom,
  refreshedMintInfoRows,
  touchedMintInfoRows,
} from "../../state/wallet/mintInfo";
import { ownerStorageAtom } from "../../state/wallet/ownerStorage";
import {
  buildMintDedupeSignature,
  dedupeMintInfoRows,
  getEncounteredMintUrls,
  mintInfoRowFields,
  resolveMintIcon,
} from "./mintInfoHelpers";

const MINT_INFO_MAX_AGE_SEC = 86_400;
const MINT_INFO_RETRY_SEC = 60;

/** Whether a mint was deleted on this device; follows the stored rows. */
export const useIsMintDeleted = () => {
  const rows = useAtomValue(mintInfoRowsAtom);
  return React.useCallback(
    (mintUrl: string) => isMintDeleted(rows, mintUrl),
    [rows],
  );
};

/** Marks a mint seen now; a new mint gets a row. */
export const useTouchMintInfo = () => {
  const registry = React.useContext(RegistryContext);
  const ownerStorage = useAtomSuspense(ownerStorageAtom).value;
  return React.useCallback(
    (mintUrl: string, nowSec: number): void => {
      const cleaned = normalizeMintUrl(mintUrl);
      const rows = registry.get(mintInfoRowsAtom);
      if (!cleaned || isMintDeleted(rows, cleaned)) return;
      ownerStorage.rememberSeenMint(cleaned);
      const next = touchedMintInfoRows(rows, cleaned, nowSec);
      if (next !== null) registry.set(mintInfoRowsAtom, next);
    },
    [ownerStorage, registry],
  );
};

/** Asks a mint for its info and stores it; one refresh per mint at a time. */
export const useRefreshMintInfo = () => {
  const registry = React.useContext(RegistryContext);
  const fetchMintInfo =
    Option.getOrNull(AsyncResult.value(useAtomValue(linkshuCommandsAtom)))
      ?.fetchMintInfo ?? null;
  const { lifecycle } = useAtomValue(platformAtom);
  return React.useCallback(
    async (mintUrl: string): Promise<void> => {
      const cleaned = normalizeMintUrl(mintUrl);
      if (!cleaned || isMintDeleted(registry.get(mintInfoRowsAtom), cleaned)) {
        return;
      }
      if (fetchMintInfo === null || !lifecycle.isOnline()) return;
      const { inFlight, lastSuccessfulAtSec } = registry.get(
        mintInfoRefreshesAtom,
      );
      if (inFlight.has(cleaned)) return;
      inFlight.add(cleaned);

      const recordRuntime = (latencyMs: number | null) =>
        registry.update(mintRuntimeAtom, (runtime) => ({
          ...runtime,
          [cleaned]: { lastCheckedAtSec: nowSec, latencyMs },
        }));
      const startedAt = performance.now();
      const nowSec = nowSeconds();
      recordRuntime(null);
      try {
        const outcome = await fetchMintInfo(cleaned);
        if (Result.isFailure(outcome)) {
          recordRuntime(null);
          return;
        }
        registry.set(
          mintInfoRowsAtom,
          refreshedMintInfoRows(
            registry.get(mintInfoRowsAtom),
            cleaned,
            mintInfoRowFields(outcome.success),
            nowSec,
          ),
        );
        recordRuntime(Math.max(0, Math.round(performance.now() - startedAt)));
        lastSuccessfulAtSec.set(cleaned, nowSec);
      } catch {
        recordRuntime(null);
      } finally {
        inFlight.delete(cleaned);
      }
    },
    [fetchMintInfo, lifecycle, registry],
  );
};

export const useMintInfoByUrl = () => useAtomValue(mintInfoByUrlAtom);

/** The stored mint info the wallet hooks share. */
export const useMintInfo = () => ({
  isMintDeleted: useIsMintDeleted(),
  mintInfoByUrl: useAtomValue(mintInfoByUrlAtom),
  mintInfoDeduped: useAtomValue(mintInfoDedupedAtom),
  refreshMintInfo: useRefreshMintInfo(),
  touchMintInfo: useTouchMintInfo(),
});

export const useMintRuntime = () => {
  const runtimeByUrl = useAtomValue(mintRuntimeAtom);
  return React.useCallback(
    (mintUrl: string) => {
      const key = normalizeMintUrl(mintUrl);
      return key ? (runtimeByUrl[key] ?? null) : null;
    },
    [runtimeByUrl],
  );
};

/** A mint's icon, and a report that it failed to load. */
export const useMintIcons = () => {
  const mintInfoByUrl = useAtomValue(mintInfoByUrlAtom);
  const failedUrls = useAtomValue(failedMintIconUrlsAtom);
  const registry = React.useContext(RegistryContext);
  const getMintIconUrl = React.useCallback(
    (mint: string | null | undefined): MintIcon =>
      resolveMintIcon(
        mint,
        mintInfoByUrl.get(normalizeMintUrl(mint))?.infoJson ?? null,
        failedUrls,
      ),
    [failedUrls, mintInfoByUrl],
  );
  const markMintIconFailed = React.useCallback(
    (url: string) =>
      registry.update(failedMintIconUrlsAtom, (prev) =>
        prev.has(url) ? prev : new Set(prev).add(url),
      ),
    [registry],
  );
  return { getMintIconUrl, markMintIconFailed };
};

/** Deletes a mint from this device's list; its proofs stay in the wallet. */
export const useDeleteMint = () => {
  const registry = React.useContext(RegistryContext);
  return React.useCallback(
    (mintUrl: string) =>
      registry.set(
        mintInfoRowsAtom,
        deletedMintInfoRows(
          registry.get(mintInfoRowsAtom),
          normalizeMintUrl(mintUrl),
        ),
      ),
    [registry],
  );
};

interface MintInfoWatchersParams {
  allowTestMints: boolean;
  defaultMintUrl: string | null;
  walletProofs: readonly StoredProof[];
}

/**
 * Keeps the default mint, the preset mints and every mint holding funds in
 * the stored list, refreshes their info once a day and merges duplicate rows.
 * Mounted once by the wallet composition.
 */
export const useMintInfoWatchers = ({
  allowTestMints,
  defaultMintUrl,
  walletProofs,
}: MintInfoWatchersParams): void => {
  const canRunNetworkWork = useDeferredOnlineReady();
  const registry = React.useContext(RegistryContext);
  const rows = useAtomValue(mintInfoRowsAtom);
  const { isMintDeleted, mintInfoByUrl, mintInfoDeduped, refreshMintInfo } =
    useMintInfo();
  const touchMintInfo = useTouchMintInfo();
  const getMintRuntime = useMintRuntime();

  const isStale = React.useCallback(
    (mintUrl: string, lastCheckedAtSec: number, nowSec: number) => {
      const lastSuccessful =
        registry.get(mintInfoRefreshesAtom).lastSuccessfulAtSec.get(mintUrl) ??
        lastCheckedAtSec;
      const lastAttempt = getMintRuntime(mintUrl)?.lastCheckedAtSec ?? 0;
      return (
        nowSec - lastSuccessful > MINT_INFO_MAX_AGE_SEC &&
        (lastAttempt === 0 || nowSec - lastAttempt > MINT_INFO_RETRY_SEC)
      );
    },
    [getMintRuntime, registry],
  );

  React.useEffect(() => {
    const cleaned = normalizeMintUrl(defaultMintUrl ?? MAIN_MINT_URL);
    if (!cleaned || isMintDeleted(cleaned)) return;

    const existing = mintInfoByUrl.get(cleaned);
    const nowSec = nowSeconds();
    if (!existing) {
      touchMintInfo(cleaned, nowSec);
      return;
    }
    if (
      canRunNetworkWork &&
      isStale(cleaned, existing.lastCheckedAtSec ?? 0, nowSec)
    ) {
      void refreshMintInfo(cleaned);
    }
  }, [
    canRunNetworkWork,
    defaultMintUrl,
    isMintDeleted,
    isStale,
    mintInfoByUrl,
    refreshMintInfo,
    touchMintInfo,
  ]);

  const encounteredMintUrls = React.useMemo(
    () => getEncounteredMintUrls(walletProofs),
    [walletProofs],
  );

  React.useEffect(() => {
    if (encounteredMintUrls.length === 0) return;

    const nowSec = nowSeconds();
    const candidates = new Set<string>([
      ...encounteredMintUrls,
      ...PRESET_MINTS,
      ...(defaultMintUrl ? [defaultMintUrl] : []),
      ...mintInfoDeduped.map((row) => row.canonicalUrl.trim()).filter(Boolean),
    ]);

    for (const mintUrl of candidates) {
      const cleaned = mintUrl.trim().replace(/\/+$/, "");
      if (
        !cleaned ||
        isMintDeleted(cleaned) ||
        isHiddenTestMint(cleaned, allowTestMints)
      )
        continue;

      const existing = mintInfoByUrl.get(cleaned);
      touchMintInfo(cleaned, nowSec);
      if (
        existing &&
        canRunNetworkWork &&
        isStale(cleaned, existing.lastCheckedAtSec ?? 0, nowSec)
      ) {
        void refreshMintInfo(cleaned);
      }
    }
  }, [
    allowTestMints,
    canRunNetworkWork,
    defaultMintUrl,
    encounteredMintUrls,
    isMintDeleted,
    isStale,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    touchMintInfo,
  ]);

  const dedupeRanForRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const signature = buildMintDedupeSignature(rows);
    if (!signature || dedupeRanForRef.current === signature) return;
    dedupeRanForRef.current = signature;
    const deduped = dedupeMintInfoRows(rows);
    if (deduped) registry.set(mintInfoRowsAtom, deduped);
  }, [registry, rows]);
};
