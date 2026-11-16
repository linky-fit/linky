import type { LoadedWallet } from "./WalletInstances";

/** Whether the mint's published info lists NUT-11 P2PK spending conditions. */
export const supportsP2pk = (wallet: LoadedWallet): boolean => {
  try {
    return wallet.getMintInfo().isSupported(11).supported;
  } catch {
    return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Whether the mint's NUT-05 bolt11 `sat` method pays invoices without an
 * amount (NUT-23). Mints publish the flag inside `options` or, like
 * cdk-mintd, flat on the method; both count.
 */
export const supportsAmountlessMelt = (wallet: LoadedWallet): boolean => {
  try {
    const methods: unknown = wallet.getMintInfo().cache.nuts["5"]?.methods;
    if (!Array.isArray(methods)) return false;
    return methods.some(
      (method: unknown) =>
        isRecord(method) &&
        method["method"] === "bolt11" &&
        method["unit"] === "sat" &&
        (method["amountless"] === true ||
          (isRecord(method["options"]) &&
            method["options"]["amountless"] === true)),
    );
  } catch {
    return false;
  }
};
