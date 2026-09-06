import type {
  GetInfoResponse,
  GetKeysResponse,
  GetKeysetsResponse,
  KeyChainCache,
  MintKeys,
  MintKeyset,
} from "@cashu/cashu-ts";
import { errorMessage } from "../../internal/errorMessage";

/**
 * Wallet loading with the cashu-ts classes injected as parameters. The narrow
 * structural types below describe exactly what the loader consumes; the real
 * cashu-ts `Mint`/`Wallet` classes satisfy them, and tests can substitute
 * fakes without casting.
 */

export interface CashuWalletOptions {
  bip39seed?: Uint8Array;
  unit?: string;
}

export interface MintLike {
  getInfo(): Promise<GetInfoResponse>;
  getKeySets(): Promise<GetKeysetsResponse>;
  getKeys(keysetId?: string): Promise<GetKeysResponse>;
}

export interface WalletLike {
  loadMint(): Promise<void>;
  loadMintFromCache(mintInfo: GetInfoResponse, cache: KeyChainCache): void;
  bindKeyset(id: string): void;
}

export interface LoadWalletArgs<
  TMint extends MintLike,
  TWallet extends WalletLike,
> {
  Mint: new (mintUrl: string) => TMint;
  Wallet: new (mint: TMint, options: CashuWalletOptions) => TWallet;
  bip39seed?: Uint8Array;
  mintUrl: string;
  unit?: string | null;
}

const isHexString = (value: string): boolean => {
  return /^[0-9a-f]+$/i.test(value);
};

const buildWalletOptions = (
  args: Pick<LoadWalletArgs<MintLike, WalletLike>, "bip39seed" | "unit">,
): CashuWalletOptions => {
  const options: CashuWalletOptions = {};
  const unit = args.unit?.trim();
  if (unit) options.unit = unit;
  if (args.bip39seed !== undefined) options.bip39seed = args.bip39seed;
  return options;
};

// Deliberately does not match "Mint keys for keyset … are unavailable" —
// that is the fallback's own thrown error, and matching it would recurse.
export const isKeysetVerificationError = (error: unknown): boolean => {
  const message = errorMessage(error, "").toLowerCase();
  return (
    message.includes("couldn't verify keyset id") ||
    message.includes("short keyset id v2") ||
    message.includes("got no keysets to map it to") ||
    message.includes("couldn't map short keyset id")
  );
};

export const pickPreferredMintKeyset = (
  keysets: readonly MintKeyset[],
  unit: string,
): MintKeyset | null => {
  const matches = keysets
    .filter((keyset) => {
      return keyset.active && keyset.unit === unit && isHexString(keyset.id);
    })
    .sort((left, right) => {
      return (left.input_fee_ppk ?? 0) - (right.input_fee_ppk ?? 0);
    });

  return matches[0] ?? null;
};

const loadWalletFromFallbackMintData = async <
  TMint extends MintLike,
  TWallet extends WalletLike,
>(
  args: LoadWalletArgs<TMint, TWallet>,
): Promise<TWallet> => {
  const options = buildWalletOptions(args);
  const mint = new args.Mint(args.mintUrl);
  const [mintInfo, keysetsResponse] = await Promise.all([
    mint.getInfo(),
    mint.getKeySets(),
  ]);

  const unit = options.unit ?? "sat";
  const keyset = pickPreferredMintKeyset(keysetsResponse.keysets, unit);
  if (!keyset) {
    throw new Error(`No active ${unit} keyset found for ${args.mintUrl}`);
  }

  // Every same-unit hex keyset, active AND inactive: inactive keysets still
  // decode old proofs, so their keys must be present in the cache too.
  const fallbackKeysets = keysetsResponse.keysets.filter((candidate) => {
    return candidate.unit === unit && isHexString(candidate.id);
  });

  const keysById = new Map<string, MintKeys>();
  await Promise.all(
    fallbackKeysets.map(async (candidate) => {
      try {
        const keysResponse = await mint.getKeys(candidate.id);
        const keys =
          keysResponse.keysets.find((keysCandidate) => {
            return (
              keysCandidate.id === candidate.id &&
              keysCandidate.unit === candidate.unit
            );
          }) ?? null;
        if (keys) {
          keysById.set(candidate.id, keys);
        }
      } catch (error) {
        if (candidate.id !== keyset.id) {
          console.warn(
            "[linkshu] fallback keyset keys unavailable, continuing",
            {
              error: errorMessage(error, ""),
              keysetId: candidate.id,
              mintUrl: args.mintUrl,
              unit,
            },
          );
        }
      }
    }),
  );

  const preferredKeys = keysById.get(keyset.id) ?? null;
  if (!preferredKeys) {
    throw new Error(`Mint keys for keyset ${keyset.id} are unavailable`);
  }

  // The cache keeps the FULL getKeySets list (any unit, any id shape) with
  // the fetched keys spliced in, so cashu-ts sees the same view a healthy
  // loadMint() would have produced.
  const cache = {
    mintUrl: args.mintUrl,
    keysets: keysetsResponse.keysets.map((candidate) => {
      const keys = keysById.get(candidate.id);
      if (!keys) return candidate;
      return { ...candidate, keys: keys.keys };
    }),
  };
  const wallet = new args.Wallet(mint, options);
  wallet.loadMintFromCache(mintInfo, cache);
  wallet.bindKeyset(keyset.id);
  return wallet;
};

export const loadWallet = async <
  TMint extends MintLike,
  TWallet extends WalletLike,
>(
  args: LoadWalletArgs<TMint, TWallet>,
): Promise<TWallet> => {
  const options = buildWalletOptions(args);
  // cashu-ts performs a direct CORS request by default. Keep its native
  // request implementation: v4 uses JSONInt for Amount values, honours
  // caller abort signals and parses u64 responses safely.
  const wallet = new args.Wallet(new args.Mint(args.mintUrl), options);

  try {
    await wallet.loadMint();
    return wallet;
  } catch (error) {
    if (!isKeysetVerificationError(error)) throw error;

    console.warn("[linkshu] keyset verification failed, using fallback", {
      error: errorMessage(error, ""),
      mintUrl: args.mintUrl,
      unit: options.unit ?? "sat",
    });

    return await loadWalletFromFallbackMintData(args);
  }
};
