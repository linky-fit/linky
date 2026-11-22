import type { Mint, RequestFn, Wallet } from "@cashu/cashu-ts";

const WALLET_LOAD_TIMEOUT_MS = 15_000;

interface LoadWalletArgs {
  Mint: typeof Mint;
  Wallet: typeof Wallet;
  bip39seed?: Uint8Array;
  mintUrl: string;
  unit?: string | null;
  timeoutMs?: number;
}

const loadTimeoutError = (timeoutMs: number): Error => {
  const error = new Error(`mint load timed out after ${timeoutMs} ms`);
  error.name = "TimeoutError";
  return error;
};

/**
 * Wraps cashu-ts's default Mint transport with `signal` so loadMint keeps all
 * SDK parsing and error types (JSONInt, RateLimitError, MintOperationError)
 * while aborting in-flight GETs on timeout or sibling failure.
 */
const abortableRequestFor = (
  mint: Mint,
  signal: AbortSignal,
): RequestFn | undefined => {
  const defaultRequest: unknown = Reflect.get(mint, "_request");
  if (typeof defaultRequest !== "function") return undefined;
  return (options) =>
    Reflect.apply(defaultRequest, mint, [{ ...options, signal }]);
};

export const loadWallet = async (args: LoadWalletArgs): Promise<Wallet> => {
  const options: NonNullable<ConstructorParameters<typeof Wallet>[1]> = {};
  const unit = args.unit?.trim();
  if (unit) options.unit = unit;
  if (args.bip39seed !== undefined) options.bip39seed = args.bip39seed;
  const mint = new args.Mint(args.mintUrl);
  const wallet = new args.Wallet(mint, options);

  const timeoutMs = args.timeoutMs ?? WALLET_LOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const loadRequest = abortableRequestFor(mint, controller.signal);
  if (loadRequest !== undefined) {
    const protoGetInfo = mint.getInfo.bind(mint);
    const protoGetKeySets = mint.getKeySets.bind(mint);
    const protoGetKeys = mint.getKeys.bind(mint);
    mint.getInfo = (customRequest) =>
      protoGetInfo(customRequest ?? loadRequest);
    mint.getKeySets = (customRequest) =>
      protoGetKeySets(customRequest ?? loadRequest);
    mint.getKeys = (keysetId, mintUrl, customRequest) =>
      protoGetKeys(keysetId, mintUrl, customRequest ?? loadRequest);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const loading = wallet.loadMint();
    // Avoid an unhandled rejection if a stubbed loadMint ignores the abort signal.
    loading.catch(() => {});
    await Promise.race([
      loading,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const timeout = loadTimeoutError(timeoutMs);
          controller.abort(timeout);
          reject(timeout);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    Reflect.deleteProperty(mint, "getInfo");
    Reflect.deleteProperty(mint, "getKeySets");
    Reflect.deleteProperty(mint, "getKeys");
  }
  return wallet;
};
