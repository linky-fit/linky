import type * as Evolu from "@evolu/common";
import {
  Autoswap,
  AutoswapDraft,
  FeeProbe,
  FeeProbeDraft,
  linkshuServices,
  Melt,
  MeltDraft,
  NonNegativeAmount,
  PaidQuoteDraft,
  QuoteLockingKey,
  Receive,
  ReceiveDraft,
  Restore,
  RestoreDraft,
  SendDraft,
  Send,
  Tokens,
  TokenRowId,
  TokenStore,
  Topup,
  TopupDraft,
  Validation,
  WalletBalances,
} from "@linky/linkshu";
import { decodeNsec } from "@linky/linkstr";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  AutoswapClaimResult,
  AutoswapError,
  AutoswapReceipt,
  Bip39Seed,
  DeletedSpentToken,
  FeeProbeError,
  InvalidTokenTransition,
  IssuedClaimReport,
  LightningFeeProbeResult,
  MeltError,
  MeltReceipt,
  MintRejected,
  MintUnreachable,
  ReceiveError,
  ReceiveReceipt,
  RestoreReport,
  RowCheckResult,
  SendError,
  SendReceipt,
  TokenRowNotFound,
  TopupAdoptError,
  TopupError,
  TopupHandle,
  TopupQuote,
  TopupReceipt,
  ValidationReport,
  WalletToken,
} from "@linky/linkshu";
import { Effect, Exit, Layer, ManagedRuntime, Schema, Scope } from "effect";
import type { Either } from "effect";
import React from "react";
import { linkshuAppInspector } from "../../../devtools/inspector/linkshuInspector";
import { migrateLegacyCashuLocalState } from "../../migrations/linkshuStorageMigration";
import type { CashuTokenRow, useEvolu } from "../../../evolu";
import { useLatest } from "../../../hooks/useLatest";
import { evoluTokenStore } from "../../../platform/linkshu/evoluTokenStore";
import { localStorageKeyValueStore } from "../../../platform/linkshu/localStorageKeyValueStore";
import { resolveLinkshuSeed } from "../../../platform/linkshu/resolveLinkshuSeed";

type EvoluMutations = ReturnType<typeof useEvolu>;

interface UseLinkshuCompositionParams {
  /** Wallet-visible rows across cashu owner lanes, already deduped. */
  cashuTokenRows: readonly CashuTokenRow[];
  /** Seed resolution re-runs when the active identity changes. */
  currentNsec: string | null;
  update: EvoluMutations["update"];
  upsert: EvoluMutations["upsert"];
  /** Active cashu write lane; null until the owners are ready. */
  writeOwnerId: Evolu.OwnerId | null;
}

const emptyBalances = new WalletBalances({
  total: NonNegativeAmount.make(0),
  spendable: NonNegativeAmount.make(0),
  perMint: [],
});

interface LinkshuReadModel {
  readonly balances: WalletBalances;
  readonly tokens: ReadonlyArray<WalletToken>;
}

const emptyReadModel: LinkshuReadModel = {
  balances: emptyBalances,
  tokens: [],
};

const sameSeed = (a: Bip39Seed, b: Bip39Seed): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/** linkshu Receive; resolves with the typed outcome, only defects reject. */
export type ReceiveCashuToken = (
  text: string,
) => Promise<Either.Either<ReceiveReceipt, ReceiveError>>;

interface SendCashuTokenArgs {
  readonly amountSat: number;
  readonly mint: string;
  /** `issued` for QR/share (claim-watched), `pending` for messenger sends. */
  readonly produceAs: "issued" | "pending";
}

/** linkshu Send; invalid mint/amount input and defects reject. */
export type SendCashuToken = (
  args: SendCashuTokenArgs,
) => Promise<Either.Either<SendReceipt, SendError>>;

interface MeltCashuInvoiceArgs {
  readonly invoice: string;
  readonly mint: string;
}

/** linkshu Melt; invalid mint/invoice input and defects reject. */
export type MeltCashuInvoice = (
  args: MeltCashuInvoiceArgs,
) => Promise<Either.Either<MeltReceipt, MeltError>>;

interface ProbeLightningFeeArgs {
  readonly mint: string;
  /** A different, Lightning-backed mint that issues the probe invoice. */
  readonly probeMint: string;
}

/** linkshu FeeProbe; invalid mint input and defects reject. */
export type ProbeLightningFee = (
  args: ProbeLightningFeeArgs,
) => Promise<Either.Either<LightningFeeProbeResult, FeeProbeError>>;

interface StartCashuTopupArgs {
  readonly amountSat: number;
  readonly mint: string;
}

/**
 * A running topup: `quote` carries the invoice to display immediately;
 * `completion` resolves with the typed outcome. It rejects only when the
 * runtime shuts down mid-flight — the persisted quote then resumes on the
 * next launch.
 */
export interface CashuTopupHandle {
  readonly quote: TopupQuote;
  readonly completion: Promise<Either.Either<TopupReceipt, TopupError>>;
}

/** linkshu Topup start; invalid mint/amount input and defects reject. */
export type StartCashuTopup = (
  args: StartCashuTopupArgs,
) => Promise<Either.Either<CashuTopupHandle, MintUnreachable | MintRejected>>;

/** Re-attaches every persisted pending topup (linkshu `Topup.resumePending`). */
export type ResumePendingCashuTopups = () => Promise<
  ReadonlyArray<CashuTopupHandle>
>;

export interface AdoptPaidCashuQuoteArgs {
  readonly mint: string;
  readonly quoteId: string;
  readonly amountSat: number;
  readonly invoice: string;
  readonly expiresAt: number | null;
  readonly locked: boolean;
}

/**
 * linkshu `Topup.adopt`: mints a quote a lightning-address server created
 * and reports paid. Invalid input and defects reject.
 */
export type AdoptPaidCashuQuote = (
  args: AdoptPaidCashuQuoteArgs,
) => Promise<Either.Either<TopupReceipt, TopupAdoptError>>;

interface AutoswapCashuArgs {
  readonly sourceMint: string;
  readonly targetMint: string;
}

/** linkshu Autoswap claim; invalid mint input and defects reject. */
type AutoswapCashu = (
  args: AutoswapCashuArgs,
) => Promise<Either.Either<AutoswapReceipt, AutoswapError>>;

/** Drains persisted pending claims (linkshu `Autoswap.resumePendingClaims`). */
type ResumePendingCashuAutoswapClaims = () => Promise<
  ReadonlyArray<AutoswapClaimResult>
>;

/** linkshu `Validation.checkAll` over stored rows; only defects reject. */
export type CheckAllCashuTokens = () => Promise<ValidationReport>;

/** NUT-07 check of a single stored row (linkshu `Validation.checkRow`). */
export type CheckCashuTokenRow = (
  rowId: string,
) => Promise<Either.Either<RowCheckResult, TokenRowNotFound>>;

/** linkshu `Restore` over the given mints; invalid mint input rejects. */
export type RestoreCashuTokens = (
  mints: ReadonlyArray<string>,
) => Promise<RestoreReport>;

type TokenTransitionError = TokenRowNotFound | InvalidTokenTransition;

/**
 * Lifecycle operations over stored token rows, keyed by the row id linkshu
 * reports (`String(CashuTokenId)`). Only typed failures come back as Left;
 * defects reject.
 */
export interface CashuTokenLifecycle {
  readonly checkIssuedClaims: () => Promise<IssuedClaimReport>;
  readonly deleteSpent: () => Promise<ReadonlyArray<DeletedSpentToken>>;
  /**
   * Drops a row whose funds verifiably left the wallet (e.g. a `pending`
   * messenger send once the message is confirmed published). Not a state
   * transition — the handed-over encoding stays valid for its recipient.
   */
  readonly forget: (rowId: string) => Promise<void>;
  readonly markExternalized: (
    rowId: string,
  ) => Promise<Either.Either<void, TokenTransitionError>>;
  readonly markIssued: (
    rowId: string,
  ) => Promise<Either.Either<void, TokenTransitionError>>;
  readonly reserve: (
    rowId: string,
  ) => Promise<Either.Either<void, TokenTransitionError>>;
  /** Re-receives the row so any handed-out encoding dies at the mint. */
  readonly returnToWallet: (
    rowId: string,
  ) => Promise<
    Either.Either<ReceiveReceipt, ReceiveError | TokenTransitionError>
  >;
}

const decodeAutoswapDraft = Schema.decodeUnknownSync(AutoswapDraft);
const decodeSendDraft = Schema.decodeUnknownSync(SendDraft);
const decodeMeltDraft = Schema.decodeUnknownSync(MeltDraft);
const decodeFeeProbeDraft = Schema.decodeUnknownSync(FeeProbeDraft);
const decodeRestoreDraft = Schema.decodeUnknownSync(RestoreDraft);
const decodeTopupDraft = Schema.decodeUnknownSync(TopupDraft);
const decodePaidQuoteDraft = Schema.decodeUnknownSync(PaidQuoteDraft);

/**
 * NUT-20 locked quotes from npub.cash are bound to the nostr key, so the
 * same secret unlocks them. It reaches linkshu only as a mint-call argument.
 */
const quoteLockingKeyOf = (nsec: string | null): QuoteLockingKey | null => {
  if (!nsec) return null;
  const secretKey = decodeNsec(nsec);
  return secretKey === null
    ? null
    : QuoteLockingKey.make(bytesToHex(secretKey));
};

/**
 * The app's linkshu composition root: resolves the seed, layers
 * `linkshuServices` over the Evolu `TokenStore` and localStorage
 * `KeyValueStore` adapters with the app inspector bridged in, and keeps a
 * `ManagedRuntime` alive for the wallet UI. The read model (token list +
 * balances) re-runs through `Tokens` whenever the underlying rows change.
 */
export const useLinkshuComposition = ({
  cashuTokenRows,
  currentNsec,
  update,
  upsert,
  writeOwnerId,
}: UseLinkshuCompositionParams) => {
  const rowsRef = useLatest(cashuTokenRows);
  const writeOwnerIdRef = useLatest(writeOwnerId);
  const updateRef = useLatest(update);
  const upsertRef = useLatest(upsert);

  const [bip39Seed, setBip39Seed] = React.useState<Bip39Seed | null>(null);

  React.useEffect(() => {
    if (!currentNsec) return;
    // Migrate before seed resolution so the runtime sees the copied counters.
    // Removal gate in docs/architecture.md.
    migrateLegacyCashuLocalState();
    let cancelled = false;
    void resolveLinkshuSeed()
      .then((seed) => {
        if (cancelled) return;
        setBip39Seed((previous) =>
          previous !== null && sameSeed(previous, seed) ? previous : seed,
        );
      })
      .catch((error: unknown) => {
        console.warn("[linky] linkshu seed resolution failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [currentNsec]);

  const linkshuRuntime = React.useMemo(() => {
    if (bip39Seed === null) return null;
    return ManagedRuntime.make(
      linkshuServices({
        bip39Seed,
        keyValueStore: localStorageKeyValueStore,
        tokenStore: evoluTokenStore({
          loadTokenRows: () => Promise.resolve(rowsRef.current),
          update: (table, payload, options) =>
            updateRef.current(table, payload, options),
          upsert: (table, payload, options) =>
            upsertRef.current(table, payload, options),
          getWriteOwnerId: () => {
            const ownerId = writeOwnerIdRef.current;
            if (ownerId === null) {
              throw new Error("linkshu write before cashu owner is ready");
            }
            return ownerId;
          },
        }),
      }).pipe(Layer.provideMerge(linkshuAppInspector)),
    );
  }, [bip39Seed, rowsRef, updateRef, upsertRef, writeOwnerIdRef]);

  /**
   * Topup polling fibers outlive the effect that started them but must die
   * with the runtime, so they run in one scope closed just before dispose.
   */
  const topupScope = React.useMemo(
    () => (linkshuRuntime === null ? null : Effect.runSync(Scope.make())),
    [linkshuRuntime],
  );

  React.useEffect(() => {
    if (linkshuRuntime === null || topupScope === null) return;
    return () => {
      void Effect.runPromise(Scope.close(topupScope, Exit.void)).then(() =>
        linkshuRuntime.dispose(),
      );
    };
  }, [linkshuRuntime, topupScope]);

  const [readModel, setReadModel] =
    React.useState<LinkshuReadModel>(emptyReadModel);

  React.useEffect(() => {
    if (linkshuRuntime === null) return;
    let cancelled = false;
    void linkshuRuntime
      .runPromise(
        Effect.gen(function* () {
          const tokens = yield* Tokens;
          return {
            balances: yield* tokens.balances,
            tokens: yield* tokens.list,
          };
        }),
      )
      .then((model) => {
        if (!cancelled) setReadModel(model);
      })
      .catch((error: unknown) => {
        console.warn("[linky] linkshu wallet read failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [cashuTokenRows, linkshuRuntime]);

  const operations = React.useMemo(() => {
    if (linkshuRuntime === null || topupScope === null) return null;
    const runtime = linkshuRuntime;
    type Env = ManagedRuntime.ManagedRuntime.Context<typeof runtime>;

    const lockingKey = quoteLockingKeyOf(currentNsec);
    const lockingOptions = lockingKey === null ? {} : { lockingKey };

    const run = <A, E>(effect: Effect.Effect<A, E, Env>): Promise<A> =>
      runtime.runPromise(effect);
    const runEither = <A, E>(
      effect: Effect.Effect<A, E, Env>,
    ): Promise<Either.Either<A, E>> => run(Effect.either(effect));
    const rowId = (id: string) => TokenRowId.make(id);

    const toHandle = (handle: TopupHandle): CashuTopupHandle => {
      const completion = runEither(handle.result);
      // Rejection means the runtime shut down mid-poll; an unwatched handle
      // must not surface that as an unhandled rejection.
      completion.catch(() => {});
      return { quote: handle.quote, completion };
    };

    const receiveCashuToken: ReceiveCashuToken = (text) =>
      runEither(
        Effect.flatMap(Receive, (receive) =>
          receive.receive(new ReceiveDraft({ text })),
        ),
      );

    const sendCashuToken: SendCashuToken = ({ amountSat, mint, produceAs }) =>
      runEither(
        Effect.suspend(() => {
          const draft = decodeSendDraft({ amount: amountSat, mint, produceAs });
          return Effect.flatMap(Send, (send) => send.send(draft));
        }),
      );

    const meltCashuInvoice: MeltCashuInvoice = ({ invoice, mint }) =>
      runEither(
        Effect.suspend(() => {
          const draft = decodeMeltDraft({ invoice, mint });
          return Effect.flatMap(Melt, (melt) => melt.melt(draft));
        }),
      );

    const startCashuTopup: StartCashuTopup = ({ amountSat, mint }) =>
      runEither(
        Effect.suspend(() => {
          const draft = decodeTopupDraft({ mint, amount: amountSat });
          return Effect.flatMap(Topup, (topup) =>
            Scope.extend(topup.start(draft), topupScope),
          );
        }).pipe(Effect.map(toHandle)),
      );

    const resumePendingCashuTopups: ResumePendingCashuTopups = () =>
      run(
        Effect.flatMap(Topup, (topup) =>
          Scope.extend(topup.resumePending(lockingOptions), topupScope),
        ).pipe(Effect.map((handles) => handles.map(toHandle))),
      );

    const adoptPaidCashuQuote: AdoptPaidCashuQuote = ({
      mint,
      quoteId,
      amountSat,
      invoice,
      expiresAt,
      locked,
    }) =>
      runEither(
        Effect.suspend(() => {
          const draft = decodePaidQuoteDraft({
            mint,
            quoteId,
            amount: amountSat,
            invoice,
            expiresAt,
            locked,
          });
          return Effect.flatMap(Topup, (topup) =>
            topup.adopt(draft, lockingOptions),
          );
        }),
      );

    const autoswapCashu: AutoswapCashu = ({ sourceMint, targetMint }) =>
      runEither(
        Effect.suspend(() => {
          const draft = decodeAutoswapDraft({ sourceMint, targetMint });
          return Effect.flatMap(Autoswap, (autoswap) => autoswap.claim(draft));
        }),
      );

    const resumePendingCashuAutoswapClaims: ResumePendingCashuAutoswapClaims =
      () =>
        run(
          Effect.flatMap(Autoswap, (autoswap) => autoswap.resumePendingClaims),
        );

    const probeLightningFee: ProbeLightningFee = ({ mint, probeMint }) =>
      runEither(
        Effect.suspend(() => {
          const draft = decodeFeeProbeDraft({ mint, probeMint });
          return Effect.flatMap(FeeProbe, (feeProbe) =>
            feeProbe.probeLightningFee(draft),
          );
        }),
      );

    const checkAllCashuTokens: CheckAllCashuTokens = () =>
      run(Effect.flatMap(Validation, (validation) => validation.checkAll));

    const checkCashuTokenRow: CheckCashuTokenRow = (id) =>
      runEither(
        Effect.flatMap(Validation, (validation) =>
          validation.checkRow(rowId(id)),
        ),
      );

    const restoreCashuTokens: RestoreCashuTokens = (mints) =>
      run(
        Effect.suspend(() => {
          const draft = decodeRestoreDraft({ mints });
          return Effect.flatMap(Restore, (restore) => restore.restore(draft));
        }),
      );

    const cashuTokenLifecycle: CashuTokenLifecycle = {
      checkIssuedClaims: () =>
        run(Effect.flatMap(Validation, (validation) => validation.checkIssued)),
      deleteSpent: () =>
        run(Effect.flatMap(Tokens, (tokens) => tokens.deleteSpent)),
      forget: (id) =>
        run(Effect.flatMap(TokenStore, (store) => store.remove(rowId(id)))),
      markExternalized: (id) =>
        runEither(
          Effect.flatMap(Tokens, (tokens) =>
            tokens.markExternalized(rowId(id)),
          ),
        ),
      markIssued: (id) =>
        runEither(
          Effect.flatMap(Tokens, (tokens) => tokens.markIssued(rowId(id))),
        ),
      reserve: (id) =>
        runEither(
          Effect.flatMap(Tokens, (tokens) => tokens.reserve(rowId(id))),
        ),
      returnToWallet: (id) =>
        runEither(
          Effect.flatMap(Tokens, (tokens) => tokens.returnToWallet(rowId(id))),
        ),
    };

    return {
      adoptPaidCashuQuote,
      autoswapCashu,
      cashuTokenLifecycle,
      checkAllCashuTokens,
      checkCashuTokenRow,
      meltCashuInvoice,
      probeLightningFee,
      receiveCashuToken,
      restoreCashuTokens,
      resumePendingCashuAutoswapClaims,
      resumePendingCashuTopups,
      sendCashuToken,
      startCashuTopup,
    };
  }, [currentNsec, linkshuRuntime, topupScope]);

  return {
    adoptPaidCashuQuote: operations?.adoptPaidCashuQuote ?? null,
    autoswapCashu: operations?.autoswapCashu ?? null,
    cashuTokenLifecycle: operations?.cashuTokenLifecycle ?? null,
    checkAllCashuTokens: operations?.checkAllCashuTokens ?? null,
    checkCashuTokenRow: operations?.checkCashuTokenRow ?? null,
    meltCashuInvoice: operations?.meltCashuInvoice ?? null,
    probeLightningFee: operations?.probeLightningFee ?? null,
    receiveCashuToken: operations?.receiveCashuToken ?? null,
    restoreCashuTokens: operations?.restoreCashuTokens ?? null,
    resumePendingCashuAutoswapClaims:
      operations?.resumePendingCashuAutoswapClaims ?? null,
    resumePendingCashuTopups: operations?.resumePendingCashuTopups ?? null,
    sendCashuToken: operations?.sendCashuToken ?? null,
    startCashuTopup: operations?.startCashuTopup ?? null,
    walletBalances: readModel.balances,
    walletTokens: readModel.tokens,
  };
};
