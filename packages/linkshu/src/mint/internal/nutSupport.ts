import type { LoadedWallet } from "./WalletInstances";

/** Whether the mint's published info lists NUT-11 P2PK spending conditions. */
export const supportsP2pk = (wallet: LoadedWallet): boolean => {
  try {
    return wallet.getMintInfo().isSupported(11).supported;
  } catch {
    return false;
  }
};
