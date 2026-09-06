import { Schema } from "effect";
import * as Evolu from "@evolu/common";
import React from "react";
import type { CashuTokenRow } from "../../../evolu";
import { useDeferredOnlineReady } from "../../../hooks/useDeferredOnlineReady";
import { LOCAL_MINT_INFO_STORAGE_KEY_PREFIX } from "../../../utils/constants";
import {
  MAIN_MINT_URL,
  normalizeMintUrl,
  PRESET_MINTS,
} from "../../../utils/mint";
import type { LocalMintInfoRow } from "../../types/appTypes";
import {
  buildMintDedupeSignature,
  dedupeMintInfoRows,
  getActiveMintInfoRows,
  getEncounteredMintUrls,
  getMintInfoByUrlMap,
  getMintInfoDedupedRows,
  isMintDeletedRow,
  parseMintInfoPayload,
} from "./mintInfoHelpers";
import {
  safeLocalStorageGetJson,
  safeLocalStorageSetJson,
} from "../../../utils/storage";
import { makeLocalId } from "../../../utils/validation";
import { nowSeconds } from "../../../utils/time";

const OptionalStoredValue = Schema.optional(
  Schema.NullOr(Schema.Union(Schema.String, Schema.Number, Schema.Boolean)),
);

const StoredMintInfoRow = Schema.Struct({
  feesJson: Schema.optional(Schema.NullOr(Schema.String)),
  firstSeenAtSec: Schema.optional(Schema.NullOr(Schema.Number)),
  id: Schema.String,
  infoJson: Schema.optional(Schema.NullOr(Schema.String)),
  isDeleted: OptionalStoredValue,
  lastCheckedAtSec: Schema.optional(Schema.NullOr(Schema.Number)),
  lastSeenAtSec: Schema.optional(Schema.NullOr(Schema.Number)),
  supportsMpp: OptionalStoredValue,
  url: Schema.String,
});

const isStoredMintInfoRow = (
  value: unknown,
): value is typeof StoredMintInfoRow.Type =>
  Schema.is(StoredMintInfoRow)(value);

interface UseMintInfoStoreParams {
  appOwnerId: Evolu.OwnerId | null;
  appOwnerIdRef: React.MutableRefObject<Evolu.OwnerId | null>;
  cashuTokensAll: readonly CashuTokenRow[];
  defaultMintUrl: string | null;
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
}

interface UseMintInfoStoreResult {
  getMintRuntime: (
    mintUrl: string,
  ) => { lastCheckedAtSec: number; latencyMs: number | null } | null;
  isMintDeleted: (mintUrl: string) => boolean;
  mintInfoByUrl: Map<string, LocalMintInfoRow>;
  mintInfoDeduped: Array<{ canonicalUrl: string; row: LocalMintInfoRow }>;
  refreshMintInfo: (mintUrl: string) => Promise<void>;
  setMintInfoAll: React.Dispatch<React.SetStateAction<LocalMintInfoRow[]>>;
  touchMintInfo: (_mintUrl: string, nowSec: number) => void;
}

export const useMintInfoStore = ({
  appOwnerId,
  appOwnerIdRef,
  cashuTokensAll,
  defaultMintUrl,
  rememberSeenMint,
}: UseMintInfoStoreParams): UseMintInfoStoreResult => {
  const canRunNetworkWork = useDeferredOnlineReady();
  const [mintInfoAll, setMintInfoAll] = React.useState<LocalMintInfoRow[]>(
    () => [],
  );

  React.useEffect(() => {
    const ownerId = appOwnerIdRef.current;
    if (!ownerId) {
      setMintInfoAll([]);
      return;
    }

    setMintInfoAll(
      safeLocalStorageGetJson(
        `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.${ownerId}`,
        Schema.Array(Schema.Unknown),
        [],
      ).filter(isStoredMintInfoRow),
    );
  }, [appOwnerId, appOwnerIdRef]);

  const mintInfo = React.useMemo(
    () => getActiveMintInfoRows(mintInfoAll),
    [mintInfoAll],
  );

  const mintInfoDeduped = React.useMemo(
    () => getMintInfoDedupedRows(mintInfo, defaultMintUrl),
    [defaultMintUrl, mintInfo],
  );

  const mintInfoByUrl = React.useMemo(
    () => getMintInfoByUrlMap(mintInfoAll),
    [mintInfoAll],
  );

  const isMintDeleted = React.useCallback(
    (mintUrl: string): boolean => {
      const cleaned = normalizeMintUrl(mintUrl);
      if (!cleaned) return false;

      return mintInfoAll.some((row) => {
        const rowUrl = normalizeMintUrl(row.url);
        return rowUrl === cleaned && isMintDeletedRow(row);
      });
    },
    [mintInfoAll],
  );

  const touchMintInfo = React.useCallback(
    (_mintUrl: string, nowSec: number): void => {
      const cleaned = normalizeMintUrl(_mintUrl);
      if (!cleaned || isMintDeleted(cleaned)) return;

      rememberSeenMint(cleaned);

      const existing = mintInfoByUrl.get(cleaned);

      const now = Evolu.PositiveInt.orThrow(Math.floor(nowSec));
      const ownerId = appOwnerIdRef.current;
      if (!ownerId) return;

      setMintInfoAll((prev) => {
        const next = [...prev];

        const firstSeen =
          existing && (existing.firstSeenAtSec ?? 0) > 0
            ? Math.floor(Number(existing?.firstSeenAtSec))
            : now;

        if (existing && !isMintDeletedRow(existing)) {
          const id = existing?.id ?? "";
          const idx = next.findIndex((row) => row.id === id);
          if (idx >= 0) {
            const prevRow = next[idx];
            const prevUrl = prevRow.url;
            const prevFirst = (prevRow.firstSeenAtSec ?? 0) || 0;
            const prevLast = (prevRow.lastSeenAtSec ?? 0) || 0;

            if (
              prevUrl === cleaned &&
              prevFirst === firstSeen &&
              prevLast === now
            ) {
              return prev;
            }

            next[idx] = {
              ...next[idx],
              url: cleaned,
              firstSeenAtSec: firstSeen,
              lastSeenAtSec: now,
            };
          }
        } else {
          next.push({
            id: makeLocalId(),
            url: cleaned,
            firstSeenAtSec: now,
            lastSeenAtSec: now,
            supportsMpp: null,
            feesJson: null,
            infoJson: null,
          });
        }

        safeLocalStorageSetJson(
          `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.${ownerId}`,
          next,
        );

        return next;
      });
    },
    [appOwnerIdRef, isMintDeleted, mintInfoByUrl, rememberSeenMint],
  );

  const encounteredMintUrls = React.useMemo(
    () => getEncounteredMintUrls(cashuTokensAll),
    [cashuTokensAll],
  );

  const [mintRuntimeByUrl, setMintRuntimeByUrl] = React.useState<
    Record<string, { lastCheckedAtSec: number; latencyMs: number | null }>
  >(() => ({}));

  const mintInfoRefreshInFlightRef = React.useRef<Set<string>>(new Set());
  const mintInfoLastSuccessfulRefreshRef = React.useRef<Map<string, number>>(
    new Map(),
  );

  React.useEffect(() => {
    mintInfoRefreshInFlightRef.current = new Set();
    mintInfoLastSuccessfulRefreshRef.current = new Map();
  }, [appOwnerId]);

  const getMintRuntime = React.useCallback(
    (mintUrl: string) => {
      const key = normalizeMintUrl(mintUrl);
      if (!key) return null;
      return mintRuntimeByUrl[key] ?? null;
    },
    [mintRuntimeByUrl],
  );

  const recordMintRuntime = React.useCallback(
    (
      mintUrl: string,
      patch: { lastCheckedAtSec: number; latencyMs: number | null },
    ) => {
      const key = normalizeMintUrl(mintUrl);
      if (!key) return;
      setMintRuntimeByUrl((prev) => ({ ...prev, [key]: patch }));
    },
    [],
  );

  const refreshMintInfo = React.useCallback(
    async (mintUrl: string) => {
      const cleaned = normalizeMintUrl(mintUrl);
      if (!cleaned || isMintDeleted(cleaned)) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }
      const ownerId = appOwnerIdRef.current;
      if (!ownerId) return;
      if (mintInfoRefreshInFlightRef.current.has(cleaned)) return;

      mintInfoRefreshInFlightRef.current.add(cleaned);

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const startedAt =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      const nowSec = nowSeconds();
      recordMintRuntime(cleaned, { lastCheckedAtSec: nowSec, latencyMs: null });

      try {
        const tryUrls = [`${cleaned}/v1/info`, `${cleaned}/info`];
        let info: unknown = null;
        let lastErr: unknown = null;

        for (const url of tryUrls) {
          try {
            const res = await fetch(url, {
              method: "GET",
              headers: { accept: "application/json" },
              signal: controller.signal,
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            info = await res.json();
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
          }
        }

        if (!info) throw lastErr ?? new Error("No info");

        const keysets: unknown = await fetch(`${cleaned}/v1/keysets`, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
        })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);

        const parsed = parseMintInfoPayload(info, keysets);
        const existing = mintInfoByUrl.get(cleaned);

        setMintInfoAll((prev) => {
          const next = [...prev];
          const idx = next
            .map((row) => normalizeMintUrl(row.url))
            .findIndex((url) => url === cleaned);

          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              supportsMpp: parsed.supportsMpp,
              feesJson: parsed.feesJson,
              infoJson: parsed.infoJson,
              lastCheckedAtSec: nowSec,
            };
          } else if (!existing || isMintDeletedRow(existing)) {
            next.push({
              id: makeLocalId(),
              url: cleaned,
              firstSeenAtSec: nowSec,
              lastSeenAtSec: nowSec,
              supportsMpp: parsed.supportsMpp,
              feesJson: parsed.feesJson,
              infoJson: parsed.infoJson,
              lastCheckedAtSec: nowSec,
            });
          }

          safeLocalStorageSetJson(
            `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.${ownerId}`,
            next,
          );

          return next;
        });

        const finishedAt =
          typeof performance !== "undefined" &&
          typeof performance.now === "function"
            ? performance.now()
            : Date.now();

        recordMintRuntime(cleaned, {
          lastCheckedAtSec: nowSec,
          latencyMs: Math.max(0, Math.round(finishedAt - startedAt)),
        });
        mintInfoLastSuccessfulRefreshRef.current.set(cleaned, nowSec);
      } catch {
        recordMintRuntime(cleaned, {
          lastCheckedAtSec: nowSec,
          latencyMs: null,
        });
      } finally {
        window.clearTimeout(timeout);
        mintInfoRefreshInFlightRef.current.delete(cleaned);
      }
    },
    [appOwnerIdRef, isMintDeleted, mintInfoByUrl, recordMintRuntime],
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

    const lastSuccessful =
      mintInfoLastSuccessfulRefreshRef.current.get(cleaned) ??
      existing.lastCheckedAtSec ??
      0;
    const lastAttempt = getMintRuntime(cleaned)?.lastCheckedAtSec ?? 0;
    if (
      canRunNetworkWork &&
      nowSec - lastSuccessful > 86_400 &&
      (lastAttempt === 0 || nowSec - lastAttempt > 60)
    ) {
      void refreshMintInfo(cleaned);
    }
  }, [
    canRunNetworkWork,
    defaultMintUrl,
    getMintRuntime,
    isMintDeleted,
    mintInfoByUrl,
    refreshMintInfo,
    touchMintInfo,
  ]);

  React.useEffect(() => {
    if (encounteredMintUrls.length === 0) return;

    const nowSec = nowSeconds();
    const candidates = new Set<string>();

    for (const mintUrl of encounteredMintUrls) candidates.add(mintUrl);
    for (const mintUrl of PRESET_MINTS) candidates.add(mintUrl);
    if (defaultMintUrl) candidates.add(defaultMintUrl);
    for (const mintInfoRow of mintInfoDeduped) {
      const url = mintInfoRow.canonicalUrl.trim();
      if (url) candidates.add(url);
    }

    for (const mintUrl of candidates) {
      const cleaned = mintUrl.trim().replace(/\/+$/, "");
      if (!cleaned || isMintDeleted(cleaned)) continue;

      const existing = mintInfoByUrl.get(cleaned);
      if (!existing) {
        touchMintInfo(cleaned, nowSec);
        continue;
      }

      touchMintInfo(cleaned, nowSec);

      const lastSuccessful =
        mintInfoLastSuccessfulRefreshRef.current.get(cleaned) ??
        existing.lastCheckedAtSec ??
        0;
      const lastAttempt = getMintRuntime(cleaned)?.lastCheckedAtSec ?? 0;
      const oneDay = 86_400;
      if (
        canRunNetworkWork &&
        nowSec - lastSuccessful > oneDay &&
        (lastAttempt === 0 || nowSec - lastAttempt > 60)
      ) {
        void refreshMintInfo(cleaned);
      }
    }
  }, [
    canRunNetworkWork,
    defaultMintUrl,
    encounteredMintUrls,
    getMintRuntime,
    isMintDeleted,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    touchMintInfo,
  ]);

  const mintDedupeRanRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const signature = buildMintDedupeSignature(mintInfoAll);
    if (!signature) return;
    if (mintDedupeRanRef.current === signature) return;

    mintDedupeRanRef.current = signature;

    const ownerId = appOwnerIdRef.current;
    if (!ownerId) return;

    const deduped = dedupeMintInfoRows(mintInfoAll);
    if (!deduped) return;

    setMintInfoAll(deduped);
    safeLocalStorageSetJson(
      `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.${ownerId}`,
      deduped,
    );
  }, [appOwnerIdRef, mintInfoAll]);

  return {
    getMintRuntime,
    isMintDeleted,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    setMintInfoAll,
    touchMintInfo,
  };
};
