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
  type WSConnection,
} from "@cashu/cashu-ts";
import { Effect, Schema } from "effect";
import { MintRejected, MintUnreachable } from "../../domain/errors";
import { withKeyLease } from "../../internal/lease";
import { ProofStore } from "../../ports/ProofStore";
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

export const KEYSET_MINT_KEY_PREFIX = "linkshu.keysetMint.";
export const KEYSET_MINT_LOCK_PREFIX = "linkshu.keysetMintLock.";

/** Storage key binding one keyset id to the mint that owns it. */
export const keysetMintKey = (keysetId: string): string =>
  KEYSET_MINT_KEY_PREFIX + encodeURIComponent(keysetId);

const keysetMintLockKey = (keysetId: string): string =>
  KEYSET_MINT_LOCK_PREFIX + encodeURIComponent(keysetId);

/**
 * Resolves the mint that owns a keyset id from existing holdings (the proofs
 * already stored under it), so ownership does not depend on which mint the
 * runtime happens to load first. Returns null when nothing is held under it.
 */
export type HoldingsOwnerResolver = (
  keysetId: string,
) => Effect.Effect<MintUrl | null>;

// cashu-ts throws from the `keysetId` getter when the wallet has no active
// keyset (a restore-only load of an inactive-only mint). Read it defensively:
// no active keyset means no new outputs are derived in this load, so there is
// nothing to bind.
const readActiveKeysetId = (wallet: LoadedWallet): string | null => {
  try {
    return wallet.keysetId;
  } catch {
    return null;
  }
};

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
  /** Shared mint socket: observe disconnects and close it after the last subscriber. */
  readonly mint: {
    readonly webSocketConnection: Pick<WSConnection, "onClose"> | undefined;
    disconnectWebSocket(): void;
  };
  readonly on: {
    mintQuoteUpdates(
      quoteIds: string[],
      onUpdate: (quote: MintQuoteBolt11Response) => void,
      onError: (error: Error) => void,
    ): Promise<() => void>;
  };
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
  resolveHoldingsOwner: HoldingsOwnerResolver = () => Effect.succeed(null),
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

  /**
   * Binds a keyset id to the mint that owns it and rejects any other mint that
   * presents it. Ownership is established from existing holdings first, then
   * from the stored binding, so an impostor cannot claim a keyset the wallet
   * already holds proofs under (e.g. after an upgrade with an empty binding
   * store or a fresh device sync). The check-and-write runs under a per-keyset
   * lease, so two concurrent loads cannot both claim an unbound keyset. A keyset
   * id is a hash of the keyset's public keys (NUT-02), so two honest mints
   * never share one.
   */
  const enforceKeysetMintBinding = (
    mint: MintUrl,
    wallet: LoadedWallet,
  ): Effect.Effect<void, MintRejected | MintUnreachable> =>
    Effect.gen(function* () {
      const keysetId = readActiveKeysetId(wallet);
      if (keysetId === null) return;

      const key = keysetMintKey(keysetId);
      // Fast path: already bound to this mint, no lock or holdings scan needed.
      if ((yield* kv.get(key)) === mint) return;

      const claim = Effect.gen(function* () {
        const stored = yield* kv.get(key);
        const owner = stored ?? (yield* resolveHoldingsOwner(keysetId));
        if (owner === null) {
          yield* kv.set(key, mint);
          return;
        }
        if (owner !== mint) {
          return yield* Effect.fail(
            new MintRejected({
              mint,
              code: null,
              detail: `keyset id ${keysetId} belongs to ${owner}; refusing to use it under ${mint}`,
            }),
          );
        }
        // Persist an ownership derived from holdings so later loads take the
        // fast path.
        if (stored === null) yield* kv.set(key, mint);
      });

      yield* withKeyLease(
        kv,
        keysetMintLockKey(keysetId),
      )(claim).pipe(
        Effect.catchTag(
          "LeaseLockTimeout",
          () =>
            new MintUnreachable({
              mint,
              detail: `could not lock the keyset ${keysetId} binding`,
            }),
        ),
      );
    });

  const get = (
    mint: MintUrl,
    unit: CurrencyUnit,
  ): Effect.Effect<LoadedWallet, MintUnreachable | MintRejected> =>
    Effect.suspend(() => {
      const key = `${mint}|${unit}`;
      const cached = inFlight.get(key);
      // The binding is checked on every load, cached included: a rejected mint
      // whose wallet promise is already cached must stay rejected.
      if (cached !== undefined)
        return awaitLoad(mint, key, cached).pipe(
          Effect.tap((wallet) => enforceKeysetMintBinding(mint, wallet)),
        );

      const loading = load(mint, unit);
      inFlight.set(key, loading);
      return awaitLoad(mint, key, loading).pipe(
        Effect.tap((wallet) => enforceKeysetMintBinding(mint, wallet)),
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
      const proofs = yield* ProofStore;
      const resolveHoldingsOwner: HoldingsOwnerResolver = (keysetId) =>
        Effect.map(proofs.loadAll, (stored) => {
          const match = stored.find((proof) => proof.keysetId === keysetId);
          return match ? match.mint : null;
        });
      return makeWalletInstances(
        kv,
        (mint, unit) =>
          loadWallet({
            Mint,
            Wallet,
            mintUrl: mint,
            unit,
            bip39seed: bip39Seed,
          }),
        resolveHoldingsOwner,
      );
    }),
  },
) {}
