import type { WalletRepository } from "@linky/linksync";
import {
  Autoswap,
  AutoswapDraft,
  FeeProbe,
  FeeProbeDraft,
  linkshuServices,
  Melt,
  MeltDraft,
  NonNegativeAmount,
  OperationId,
  PaidQuoteDraft,
  QuoteLockingKey,
  Receive,
  ReceiveDraft,
  Restore,
  RestoreDraft,
  SendDraft,
  Send,
  Tokens,
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
  FeeProbeError,
  ImportProofDraft,
  InvalidTransferTransition,
  IssuedClaimReport,
  LegacyIngestReport,
  LegacyTokenRow,
  LightningFeeProbeResult,
  MeltError,
  MeltReceipt,
  MeltResumeResult,
  MintRejected,
  MintUnreachable,
  NewOperation,
  OperationNotFound,
  ProofStateSnapshot,
  ReceiveError,
  ReceiveReceipt,
  ReclaimReport,
  RestoreReport,
  RestoreProgress,
  SendError,
  SendReceipt,
  StoredOperation,
  StoredProof,
  TokenTransfer,
  TopupAdoptError,
  TopupError,
  TopupHandle,
  TopupQuote,
  TopupReceipt,
  TransferCheckResult,
  ValidationReport,
} from "@linky/linkshu";
import { Effect, Exit, Layer, ManagedRuntime, Schema, Scope } from "effect";
import type { Either } from "effect";
import React from "react";
import { linkshuAppInspector } from "../../../devtools/inspector/linkshuInspector";
import { migrateLegacyCashuLocalState } from "../../migrations/linkshuStorageMigration";
import { localStorageKeyValueStore } from "../../../platform/linkshu/localStorageKeyValueStore";
import { resolveLinkshuSeed } from "../../../platform/linkshu/resolveLinkshuSeed";

interface UseLinkshuCompositionParams {
  /** Seed resolution re-runs when the active identity changes. */
  currentNsec: string | null;
  /** The proof and operation stores over the cashu shards. */
  wallet: WalletRepository;
}

const emptyBalances = new WalletBalances({
  total: NonNegativeAmount.make(0),
  spendable: NonNegativeAmount.make(0),
  perMint: [],
});

interface LinkshuReadModel {
  readonly balances: WalletBalances;
  readonly proofs: ReadonlyArray<StoredProof>;
  readonly operations: ReadonlyArray<StoredOperation>;
  readonly transfers: ReadonlyArray<TokenTransfer>;
}

const emptyReadModel: LinkshuReadModel = {
  balances: emptyBalances,
  proofs: [],
  operations: [],
  transfers: [],
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

/** Settles persisted unsettled melts (linkshu `Melt.resumePending`). */
export type ResumePendingCashuMelts = () => Promise<
  ReadonlyArray<MeltResumeResult>
>;

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

/** Read-only mint status of every unspent proof, for the Tokens page. */
export type InspectCashuProofStates = () => Promise<
  ReadonlyArray<ProofStateSnapshot>
>;

/** linkshu `Validation.checkAll` over the inventory; only defects reject. */
export type CheckAllCashuTokens = () => Promise<ValidationReport>;

/** NUT-07 check of one transfer (linkshu `Validation.checkTransfer`). */
export type CheckCashuTransfer = (
  operationId: string,
) => Promise<Either.Either<TransferCheckResult, OperationNotFound>>;

/** Scan the given mints and swap only newly discovered proofs. */
export type RestoreCashuTokens = (
  mints: ReadonlyArray<string>,
  onProgress?: (progress: RestoreProgress) => void,
) => Promise<{ restore: RestoreReport; reclaim: ReclaimReport }>;

export type ReclaimCashuTokens = (mints?: ReadonlyArray<string>) => Promise<{
  restore: RestoreReport | null;
  reclaim: ReclaimReport;
}>;

type TransferTransitionError = OperationNotFound | InvalidTransferTransition;

/**
 * Lifecycle operations over stored transfers, keyed by the operation id
 * linkshu reports (`String(CashuOperationId)`). Only typed failures come
 * back as Left; defects reject.
 */
export interface CashuTransferLifecycle {
  /** Reclaims only this transfer's remaining handed-out proofs, including delivered sends. */
  readonly reclaim: (operationId: string) => Promise<ReclaimReport>;
  readonly checkIssuedClaims: () => Promise<IssuedClaimReport>;
  /**
   * Closes a transfer the caller has nothing left to do about (a `pending`
   * messenger send once the message is confirmed published). Not a refund:
   * the handed-over encoding stays valid for its recipient.
   */
  readonly forget: (
    operationId: string,
  ) => Promise<Either.Either<void, TransferTransitionError>>;
  /** Restores backup proofs as-is; returns how many were new. */
  readonly importProofs: (
    drafts: ReadonlyArray<ImportProofDraft>,
  ) => Promise<number>;
  /** Restores a backup operation as-is. */
  readonly importOperation: (draft: NewOperation) => Promise<OperationId>;
  /** Ingests token rows of a pre-inventory backup, like the legacy table. */
  readonly importLegacyRows: (
    rows: ReadonlyArray<LegacyTokenRow>,
  ) => Promise<LegacyIngestReport>;
  readonly markExternalized: (
    operationId: string,
  ) => Promise<Either.Either<void, TransferTransitionError>>;
  readonly markIssued: (
    operationId: string,
  ) => Promise<Either.Either<void, TransferTransitionError>>;
  /** Re-receives a handed-out token, or retries a failed receive. */
  readonly returnToWallet: (
    operationId: string,
  ) => Promise<
    Either.Either<ReceiveReceipt, ReceiveError | TransferTransitionError>
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
 * `linkshuServices` over the shard wallet repository's `ProofStore` and
 * `OperationStore` and the localStorage `KeyValueStore` with the app
 * inspector bridged in, and keeps a `ManagedRuntime` alive for the wallet
 * UI. The read model (proofs, transfers, balances) re-runs through `Tokens`
 * whenever the wallet repository reports a change.
 */
export const useLinkshuComposition = ({
  currentNsec,
  wallet,
}: UseLinkshuCompositionParams) => {
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
        proofStore: wallet.proofStore,
        operationStore: wallet.operationStore,
      }).pipe(Layer.provideMerge(linkshuAppInspector)),
    );
  }, [bip39Seed, wallet]);

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

  const [readModel, setReadModel] = React.useState<{
    readonly model: LinkshuReadModel;
    readonly loaded: boolean;
  }>({ model: emptyReadModel, loaded: false });

  const [walletVersion, setWalletVersion] = React.useState(0);
  React.useEffect(
    () => wallet.subscribe(() => setWalletVersion((value) => value + 1)),
    [wallet],
  );

  React.useEffect(() => {
    if (linkshuRuntime === null) return;
    let cancelled = false;
    void linkshuRuntime
      .runPromise(
        Effect.gen(function* () {
          const tokens = yield* Tokens;
          return {
            balances: yield* tokens.balances,
            proofs: yield* tokens.proofs,
            operations: yield* tokens.operations,
            transfers: yield* tokens.transfers,
          };
        }),
      )
      .then((model) => {
        if (!cancelled) setReadModel({ model, loaded: true });
      })
      .catch((error: unknown) => {
        console.warn("[linky] linkshu wallet read failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [linkshuRuntime, walletVersion]);

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
    const operationId = (id: string) => OperationId.make(id);

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

    const resumePendingCashuMelts: ResumePendingCashuMelts = () =>
      run(Effect.flatMap(Melt, (melt) => melt.resumePending));

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

    const inspectCashuProofStates: InspectCashuProofStates = () =>
      run(
        Effect.flatMap(
          Validation,
          (validation) => validation.inspectProofStates,
        ),
      );

    const checkAllCashuTokens: CheckAllCashuTokens = () =>
      run(Effect.flatMap(Validation, (validation) => validation.checkAll));

    const checkCashuTransfer: CheckCashuTransfer = (id) =>
      runEither(
        Effect.flatMap(Validation, (validation) =>
          validation.checkTransfer(operationId(id)),
        ),
      );

    const restoreCashuTokens: RestoreCashuTokens = (mints, onProgress) =>
      run(
        Effect.suspend(() => {
          const draft = decodeRestoreDraft({ mints });
          return Effect.flatMap(Restore, (restore) =>
            restore.restoreAndReclaim(draft, onProgress),
          );
        }),
      );

    const reclaimCashuTokens: ReclaimCashuTokens = (mints) =>
      run(
        Effect.gen(function* () {
          const tokens = yield* Tokens;
          const restore =
            mints === undefined
              ? null
              : yield* Effect.flatMap(Restore, (service) =>
                  service.restore(decodeRestoreDraft({ mints })),
                );
          const ids = (yield* tokens.proofs)
            .filter(
              (proof) =>
                proof.state === "handedOut" ||
                proof.state === "externalized" ||
                (mints !== undefined && proof.state === "available"),
            )
            .map((proof) => proof.id);
          return { restore, reclaim: yield* tokens.reclaim(ids) };
        }),
      );

    const cashuTransferLifecycle: CashuTransferLifecycle = {
      reclaim: (id) =>
        run(
          Effect.gen(function* () {
            const tokens = yield* Tokens;
            const transferId = operationId(id);
            const ids = (yield* tokens.proofs)
              .filter(
                (proof) =>
                  proof.operationId === transferId &&
                  (proof.state === "handedOut" ||
                    proof.state === "externalized"),
              )
              .map((proof) => proof.id);
            return yield* tokens.reclaim(ids);
          }),
        ),
      checkIssuedClaims: () =>
        run(Effect.flatMap(Validation, (validation) => validation.checkIssued)),
      forget: (id) =>
        runEither(
          Effect.flatMap(Tokens, (tokens) => tokens.forget(operationId(id))),
        ),
      importProofs: (drafts) =>
        run(Effect.flatMap(Tokens, (tokens) => tokens.importProofs(drafts))),
      importOperation: (draft) =>
        run(Effect.flatMap(Tokens, (tokens) => tokens.importOperation(draft))),
      importLegacyRows: (rows) =>
        run(Effect.flatMap(Tokens, (tokens) => tokens.ingestLegacyRows(rows))),
      markExternalized: (id) =>
        runEither(
          Effect.flatMap(Tokens, (tokens) =>
            tokens.markExternalized(operationId(id)),
          ),
        ),
      markIssued: (id) =>
        runEither(
          Effect.flatMap(Tokens, (tokens) =>
            tokens.markIssued(operationId(id)),
          ),
        ),
      returnToWallet: (id) =>
        runEither(
          Effect.flatMap(Tokens, (tokens) =>
            tokens.returnToWallet(operationId(id)),
          ),
        ),
    };

    return {
      adoptPaidCashuQuote,
      autoswapCashu,
      cashuTransferLifecycle,
      checkAllCashuTokens,
      inspectCashuProofStates,
      checkCashuTransfer,
      meltCashuInvoice,
      probeLightningFee,
      receiveCashuToken,
      restoreCashuTokens,
      reclaimCashuTokens,
      resumePendingCashuAutoswapClaims,
      resumePendingCashuMelts,
      resumePendingCashuTopups,
      sendCashuToken,
      startCashuTopup,
    };
  }, [currentNsec, linkshuRuntime, topupScope]);

  return {
    adoptPaidCashuQuote: operations?.adoptPaidCashuQuote ?? null,
    autoswapCashu: operations?.autoswapCashu ?? null,
    cashuTransferLifecycle: operations?.cashuTransferLifecycle ?? null,
    checkAllCashuTokens: operations?.checkAllCashuTokens ?? null,
    inspectCashuProofStates: operations?.inspectCashuProofStates ?? null,
    checkCashuTransfer: operations?.checkCashuTransfer ?? null,
    meltCashuInvoice: operations?.meltCashuInvoice ?? null,
    probeLightningFee: operations?.probeLightningFee ?? null,
    receiveCashuToken: operations?.receiveCashuToken ?? null,
    restoreCashuTokens: operations?.restoreCashuTokens ?? null,
    reclaimCashuTokens: operations?.reclaimCashuTokens ?? null,
    resumePendingCashuAutoswapClaims:
      operations?.resumePendingCashuAutoswapClaims ?? null,
    resumePendingCashuMelts: operations?.resumePendingCashuMelts ?? null,
    resumePendingCashuTopups: operations?.resumePendingCashuTopups ?? null,
    sendCashuToken: operations?.sendCashuToken ?? null,
    startCashuTopup: operations?.startCashuTopup ?? null,
    walletBalances: readModel.model.balances,
    /** True once the first inventory read answered; false shows as an empty wallet. */
    walletLoaded: readModel.loaded,
    walletOperations: readModel.model.operations,
    walletProofs: readModel.model.proofs,
    walletTransfers: readModel.model.transfers,
  };
};
