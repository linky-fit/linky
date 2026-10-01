import { nowSeconds } from "../../utils/time";

export interface ReceivingMintBookkeeping {
  readonly isMintDeleted: (mintUrl: string) => boolean;
  readonly mintInfoByUrl: ReadonlyMap<
    string,
    { readonly lastCheckedAtSec?: number | null | undefined }
  >;
  readonly refreshMintInfo: (mintUrl: string) => Promise<void> | void;
  readonly touchMintInfo: (mintUrl: string, nowSec: number) => void;
}

/**
 * Marks the mint a token was just received at as used, unless the user
 * deleted it; a known mint whose info was never checked gets it fetched.
 */
export const touchReceivingMint = (
  mint: string,
  {
    isMintDeleted,
    mintInfoByUrl,
    refreshMintInfo,
    touchMintInfo,
  }: ReceivingMintBookkeeping,
): void => {
  const cleanedMint = mint.trim().replace(/\/+$/, "");
  if (!cleanedMint || isMintDeleted(cleanedMint)) return;
  const existing = mintInfoByUrl.get(cleanedMint);
  touchMintInfo(cleanedMint, nowSeconds());
  if (existing && !existing.lastCheckedAtSec) void refreshMintInfo(cleanedMint);
};
