import type { OwnerId } from "@evolu/common";
import React from "react";
import type { CashuTokenRow } from "../../evolu";
import type { MintIcon } from "../../utils/mint";
import {
  GENERIC_MINT_ICON_DATA_URL,
  getMintIconOverride,
  getMintOriginAndHost,
  normalizeMintUrl,
} from "../../utils/mint";
import type { LocalMintInfoRow } from "../types/appTypes";
import { getMintInfoIconUrl } from "./mint/mintInfoHelpers";
import { useMintInfoStore } from "./mint/useMintInfoStore";

interface UseMintDomainParams {
  appOwnerId: OwnerId | null;
  appOwnerIdRef: React.MutableRefObject<OwnerId | null>;
  cashuTokensAll: readonly CashuTokenRow[];
  defaultMintUrl: string | null;
  rememberSeenMint: (mintUrl: string | null | undefined) => void;
}

interface UseMintDomainResult {
  getMintIconUrl: (mint: string | null | undefined) => MintIcon;
  getMintRuntime: (
    mintUrl: string,
  ) => { lastCheckedAtSec: number; latencyMs: number | null } | null;
  isMintDeleted: (mintUrl: string) => boolean;
  mintInfoByUrl: Map<string, LocalMintInfoRow>;
  mintInfoDeduped: Array<{ canonicalUrl: string; row: LocalMintInfoRow }>;
  refreshMintInfo: (mintUrl: string) => Promise<void>;
  setMintIconUrlByMint: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;
  setMintInfoAll: React.Dispatch<React.SetStateAction<LocalMintInfoRow[]>>;
  touchMintInfo: (_mintUrl: string, nowSec: number) => void;
}

export const useMintDomain = ({
  appOwnerId,
  appOwnerIdRef,
  cashuTokensAll,
  defaultMintUrl,
  rememberSeenMint,
}: UseMintDomainParams): UseMintDomainResult => {
  const [mintIconUrlByMint, setMintIconUrlByMint] = React.useState<
    Record<string, string | null>
  >(() => ({}));

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
    cashuTokensAll,
    defaultMintUrl,
    rememberSeenMint,
  });

  const getMintIconUrl = React.useCallback(
    (
      mint: string | null | undefined,
    ): {
      origin: string | null;
      url: string | null;
      host: string | null;
      failed: boolean;
    } => {
      const { origin, host } = getMintOriginAndHost(mint);
      if (!origin) {
        return {
          origin: null,
          url: GENERIC_MINT_ICON_DATA_URL,
          host,
          failed: false,
        };
      }

      if (Object.prototype.hasOwnProperty.call(mintIconUrlByMint, origin)) {
        const stored = mintIconUrlByMint[origin];
        return {
          origin,
          url: stored ?? null,
          host,
          failed: stored === null,
        };
      }

      const normalizedMintUrl = normalizeMintUrl(mint);
      const infoIcon = getMintInfoIconUrl(
        mint,
        mintInfoByUrl.get(normalizedMintUrl)?.infoJson ?? null,
      );
      if (infoIcon) return { origin, url: infoIcon, host, failed: false };

      const override = getMintIconOverride(host);
      if (override) return { origin, url: override, host, failed: false };

      return {
        origin,
        url: `${origin}/favicon.ico`,
        host,
        failed: false,
      };
    },
    [mintIconUrlByMint, mintInfoByUrl],
  );

  return {
    getMintIconUrl,
    getMintRuntime,
    isMintDeleted,
    mintInfoByUrl,
    mintInfoDeduped,
    refreshMintInfo,
    setMintIconUrlByMint,
    setMintInfoAll,
    touchMintInfo,
  };
};
