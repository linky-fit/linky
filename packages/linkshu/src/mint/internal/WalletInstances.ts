import {
  HttpResponseError,
  Mint,
  MintInfo as CashuMintInfo,
  MintOperationError,
  NetworkError,
  Wallet,
  type AmountLike,
  type KeyChain,
  type MeltProofsConfig,
  type MeltProofsResponse,
  type MeltQuoteBolt11Response,
  type MintProofsConfig,
  type MintQuoteBolt11Response,
  type OutputConfig,
  type OutputType,
  type Proof,
  type ProofLike,
  type ProofState,
  type ReceiveConfig,
  type RestoreConfig,
  type SendConfig,
  type SendResponse,
} from "@cashu/cashu-ts";
import { Effect, Schema } from "effect";
import { MintRejected, MintUnreachable } from "../../domain/errors";
import { KeysetId } from "../../domain/primitives";
import type { CurrencyUnit, MintUrl } from "../../domain/primitives";
import { CashuSeed } from "../../ports/CashuSeed";
import {
  KeyValueStore,
  type KeyValueStoreService,
} from "../../ports/KeyValueStore";
import { errorMessage } from "../../internal/errorMessage";
import { loadWallet } from "./loadWallet";

export const SEEN_MINTS_KEY_PREFIX = "linkshu.seenMints.";

export const seenMintKey = (mint: MintUrl): string =>
  SEEN_MINTS_KEY_PREFIX + encodeURIComponent(mint);

/**
 * The slice of a loaded cashu-ts wallet the package reads back after load.
 * The real `Wallet` satisfies it structurally; widen it as verticals need
 * more of the wallet. Raw cashu-ts wallets never cross the public boundary.
 */
export interface LoadedWallet {
  readonly keysetId: string;
  readonly keyChain: Pick<KeyChain, "getKeysets">;
  getMintInfo(): CashuMintInfo;
  receive(
    token: string,
    config?: ReceiveConfig,
    outputType?: OutputType,
  ): Promise<Proof[]>;
  send(
    amount: AmountLike,
    proofs: ProofLike[],
    config?: SendConfig,
    outputConfig?: OutputConfig,
  ): Promise<SendResponse>;
  checkProofsStates(
    proofs: Array<Pick<ProofLike, "secret" | "id">>,
  ): Promise<ProofState[]>;
  createMintQuoteBolt11(
    amount: AmountLike,
    description?: string,
  ): Promise<MintQuoteBolt11Response>;
  checkMintQuoteBolt11(quote: string): Promise<MintQuoteBolt11Response>;
  mintProofsBolt11(
    amount: AmountLike,
    quote: string,
    config?: MintProofsConfig,
    outputType?: OutputType,
  ): Promise<Proof[]>;
  createMeltQuoteBolt11(
    invoice: string,
    amountMsat?: AmountLike,
  ): Promise<MeltQuoteBolt11Response>;
  checkMeltQuoteBolt11(
    quote: string | MeltQuoteBolt11Response,
  ): Promise<MeltQuoteBolt11Response>;
  meltProofsBolt11(
    meltQuote: MeltQuoteBolt11Response,
    proofsToSend: ProofLike[],
    config?: MeltProofsConfig,
    outputType?: OutputType,
  ): Promise<MeltProofsResponse<MeltQuoteBolt11Response>>;
  restore(
    start: number,
    count: number,
    config?: RestoreConfig,
  ): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }>;
  /** `restore` in `batchSize` steps until `gapLimit` positions come back empty. */
  batchRestore(
    gapLimit?: number,
    batchSize?: number,
    counter?: number,
    keysetId?: string,
  ): Promise<{ proofs: Proof[]; lastCounterWithSignature?: number }>;
}

const decodeKeysetId = Schema.decodeUnknownOption(KeysetId);

/** The wallet's bound keyset id as the branded type counter scopes require. */
export const boundKeysetId = (
  mint: MintUrl,
  wallet: LoadedWallet,
): Effect.Effect<KeysetId, MintRejected> => {
  const decoded = decodeKeysetId(wallet.keysetId);
  return decoded._tag === "Some"
    ? Effect.succeed(decoded.value)
    : Effect.fail(
        new MintRejected({
          mint,
          code: null,
          detail: `wallet bound to non-hex keyset id "${wallet.keysetId}"`,
        }),
      );
};

/**
 * The package's error-classification rule (see `domain/errors.ts`): raw
 * cashu-ts/mint failures never cross the boundary. Transient network-shaped
 * failures map to `MintUnreachable`; everything else is a definitive
 * `MintRejected`, carrying the NUT error code when cashu-ts exposes one.
 */
export const classifyMintError = (
  mint: MintUrl,
  error: unknown,
): MintUnreachable | MintRejected => {
  const detail = errorMessage(error, "unknown mint error");
  if (error instanceof MintOperationError) {
    return new MintRejected({ mint, code: error.code, detail });
  }
  if (error instanceof HttpResponseError) {
    return error.status >= 500
      ? new MintUnreachable({ mint, detail })
      : new MintRejected({ mint, code: null, detail });
  }
  // NetworkError is cashu-ts's fetch-failure wrapper; a bare TypeError is
  // what fetch itself throws when the request never reached the server.
  if (error instanceof NetworkError || error instanceof TypeError) {
    return new MintUnreachable({ mint, detail });
  }
  if (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    return new MintUnreachable({ mint, detail });
  }
  return new MintRejected({ mint, code: null, detail });
};

export type WalletLoader = (
  mint: MintUrl,
  unit: CurrencyUnit,
) => Promise<LoadedWallet>;

/**
 * Single-flight per mint+unit: the in-flight Promise is stored before the
 * first await, so concurrent callers share one load and the same mint/unit
 * is never loaded twice concurrently. Successful loads stay cached for the
 * runtime's lifetime; failures evict so the next call retries.
 */
export const makeWalletInstances = (
  kv: KeyValueStoreService,
  load: WalletLoader,
) => {
  const inFlight = new Map<string, Promise<LoadedWallet>>();

  const awaitLoad = (
    mint: MintUrl,
    key: string,
    loading: Promise<LoadedWallet>,
  ): Effect.Effect<LoadedWallet, MintUnreachable | MintRejected> =>
    Effect.tryPromise({
      try: () => loading,
      catch: (error) => classifyMintError(mint, error),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          // Evict only our own failed promise: a retry may already have
          // installed a fresh in-flight load under the same key.
          if (inFlight.get(key) === loading) inFlight.delete(key);
        }),
      ),
    );

  const get = (
    mint: MintUrl,
    unit: CurrencyUnit,
  ): Effect.Effect<LoadedWallet, MintUnreachable | MintRejected> =>
    Effect.suspend(() => {
      const key = `${mint}|${unit}`;
      const cached = inFlight.get(key);
      if (cached !== undefined) return awaitLoad(mint, key, cached);

      const loading = load(mint, unit);
      inFlight.set(key, loading);
      return awaitLoad(mint, key, loading).pipe(
        Effect.tap(() => kv.set(seenMintKey(mint), mint)),
      );
    });

  return { get } as const;
};

/**
 * The single unified wallet-instance cache (one loaded cashu-ts wallet per
 * mint+unit) shared by every vertical through layer memoization of
 * `WalletInstances.Default`. Internal: not exported from the package index.
 */
export class WalletInstances extends Effect.Service<WalletInstances>()(
  "linkshu/internal/WalletInstances",
  {
    effect: Effect.gen(function* () {
      const { bip39Seed } = yield* CashuSeed;
      const kv = yield* KeyValueStore;
      return makeWalletInstances(kv, (mint, unit) =>
        loadWallet({ Mint, Wallet, mintUrl: mint, unit, bip39seed: bip39Seed }),
      );
    }),
  },
) {}
