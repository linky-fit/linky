import type { OwnerId } from "@evolu/common";
import React from "react";
import type { StoredProof } from "@linky/linkshu";
import type { MintIcon } from "../../utils/mint";
import { normalizeMintUrl } from "../../utils/mint";
import type { LocalMintInfoRow } from "../types/appTypes";
import { resolveMintIcon } from "./mint/mintInfoHelpers";
import { useMintInfoStore } from "./mint/useMintInfoStore";

interface UseMintDomainParams {
  appOwnerId: OwnerId | null;
  appOwnerIdRef: React.MutableRefObject<OwnerId | null>;
  walletProofs: readonly StoredProof[];
  defaultMintUrl: string | null;
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
}

interface UseMintDomainResult {
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  getMintRuntime: (
    mintUrl: string,
  ) => { lastCheckedAtSec: number; latencyMs: number | null } | null;
  isMintDeleted: (mintUrl: string) => boolean;
  markMintIconFailed: (url: string) => void;
  mintInfoByUrl: Map<string, LocalMintInfoRow>;
  mintInfoDeduped: Array<{ canonicalUrl: string; row: LocalMintInfoRow }>;
  refreshMintInfo: (mintUrl: string) => Promise<void>;
  setMintInfoAll: React.Dispatch<React.SetStateAction<LocalMintInfoRow[]>>;
  touchMintInfo: (_mintUrl: string, nowSec: number) => void;
}

export const useMintDomain = ({
  appOwnerId,
  appOwnerIdRef,
  walletProofs,
  defaultMintUrl,
  rememberSeenMint,
}: UseMintDomainParams): UseMintDomainResult => {
  // Icon URLs that failed to load in this session.
  const [failedMintIconUrls, setFailedMintIconUrls] = React.useState<
    ReadonlySet<string>
  >(() => new Set<string>());

  const {
    getMintRuntime,
    isMintDeleted,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    setMintInfoAll,
    touchMintInfo,
  } = useMintInfoStore({
    appOwnerId,
    appOwnerIdRef,
    walletProofs,
    defaultMintUrl,
    rememberSeenMint,
  });

  const markMintIconFailed = React.useCallback((url: string) => {
    setFailedMintIconUrls((prev) =>
      prev.has(url) ? prev : new Set(prev).add(url),
    );
  }, []);

  const getMintIconUrl = React.useCallback(
    (mint: string | null | undefined): MintIcon =>
      resolveMintIcon(
        mint,
        mintInfoByUrl.get(normalizeMintUrl(mint))?.infoJson ?? null,
        failedMintIconUrls,
      ),
    [failedMintIconUrls, mintInfoByUrl],
  );

  return {
    getMintIconUrl,
    getMintRuntime,
    isMintDeleted,
    markMintIconFailed,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    setMintInfoAll,
    touchMintInfo,
  };
};
