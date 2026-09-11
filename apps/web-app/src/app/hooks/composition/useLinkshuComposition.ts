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
  RestoreReport,
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
import type {
  CashuOperationRow,
  CashuProofRow,
  CashuTokenRow,
  useEvolu,
} from "../../../evolu";
import { useLatest } from "../../../hooks/useLatest";
import { evoluOperationStore } from "../../../platform/linkshu/evoluOperationStore";
import { evoluProofStore } from "../../../platform/linkshu/evoluProofStore";
import { localStorageKeyValueStore } from "../../../platform/linkshu/localStorageKeyValueStore";
import { resolveLinkshuSeed } from "../../../platform/linkshu/resolveLinkshuSeed";
import { toLegacyTokenRow } from "../../lib/legacyTokenRow";

type EvoluMutations = ReturnType<typeof useEvolu>;

interface UseLinkshuCompositionParams {
  /** Inventory rows across cashu owner lanes, deduped by id. */
  cashuProofRows: readonly CashuProofRow[];
  /** Operation rows across cashu owner lanes, deduped by id. */
  cashuOperationRows: readonly CashuOperationRow[];
  /** Read-only legacy `cashuToken` rows, ingested into the inventory on load. */
  legacyTokenRows: readonly CashuTokenRow[];
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

/** linkshu `Restore` over the given mints; invalid mint input rejects. */
export type RestoreCashuTokens = (
  mints: ReadonlyArray<string>,
) => Promise<RestoreReport>;

type TransferTransitionError = OperationNotFound | InvalidTransferTransition;

/**
 * Lifecycle operations over stored transfers, keyed by the operation id
 * linkshu reports (`String(CashuOperationId)`). Only typed failures come
 * back as Left; defects reject.
 */
export interface CashuTransferLifecycle {
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
 * `linkshuServices` over the Evolu `ProofStore`/`OperationStore` and
 * localStorage `KeyValueStore` adapters with the app inspector bridged in,
 * and keeps a `ManagedRuntime` alive for the wallet UI. The read model
 * (proofs, transfers, balances) re-runs through `Tokens` whenever the
 * underlying rows change, and legacy `cashuToken` rows are ingested into
 * the inventory whenever they change.
 */
export const useLinkshuComposition = ({
  cashuProofRows,
  cashuOperationRows,
  legacyTokenRows,
  currentNsec,
  update,
  upsert,
  writeOwnerId,
}: UseLinkshuCompositionParams) => {
  const proofRowsRef = useLatest(cashuProofRows);
  const operationRowsRef = useLatest(cashuOperationRows);
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
    const getWriteOwnerId = () => {
      const ownerId = writeOwnerIdRef.current;
      if (ownerId === null) {
        throw new Error("linkshu write before cashu owner is ready");
      }
      return ownerId;
    };
    return ManagedRuntime.make(
      linkshuServices({
        bip39Seed,
        keyValueStore: localStorageKeyValueStore,
        proofStore: evoluProofStore({
          loadProofRows: () => proofRowsRef.current,
          update: (table, payload, options) =>
            updateRef.current(table, payload, options),
          upsert: (table, payload, options) =>
            upsertRef.current(table, payload, options),
          getWriteOwnerId,
        }),
        operationStore: evoluOperationStore({
          loadOperationRows: () => operationRowsRef.current,
          update: (table, payload, options) =>
            updateRef.current(table, payload, options),
          upsert: (table, payload, options) =>
            upsertRef.current(table, payload, options),
          getWriteOwnerId,
        }),
      }).pipe(Layer.provideMerge(linkshuAppInspector)),
    );
  }, [
    bip39Seed,
    operationRowsRef,
    proofRowsRef,
    updateRef,
    upsertRef,
    writeOwnerIdRef,
  ]);

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
            proofs: yield* tokens.proofs,
            operations: yield* tokens.operations,
            transfers: yield* tokens.transfers,
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
  }, [cashuProofRows, cashuOperationRows, linkshuRuntime]);

  // The legacy `cashuToken` table is a permanent read-only feed: any row
  // whose proofs are not yet in the inventory is ingested, on every device,
  // whenever the rows change. Ids derive from secrets, so devices converge.
  const ingestInFlightRef = React.useRef(false);
  React.useEffect(() => {
    if (linkshuRuntime === null || writeOwnerId === null) return;
    if (ingestInFlightRef.current) return;
    const rows = legacyTokenRows.flatMap((row) => {
      const legacy = toLegacyTokenRow(row);
      return legacy === null ? [] : [legacy];
    });
    if (rows.length === 0) return;
    ingestInFlightRef.current = true;
    void linkshuRuntime
      .runPromise(
        Effect.flatMap(Tokens, (tokens) => tokens.ingestLegacyRows(rows)),
      )
      .catch((error: unknown) => {
        console.warn("[linky] legacy cashu row ingest failed", error);
      })
      .finally(() => {
        ingestInFlightRef.current = false;
      });
  }, [legacyTokenRows, linkshuRuntime, writeOwnerId]);

  // Every operation may write to the active cashu lane (the launch resumers
  // carry legacy records over into operations), so none is offered before
  // the lane is known. Later rotations do not rebuild the operations.
  const ownerReady = writeOwnerId !== null;
  const operations = React.useMemo(() => {
    if (linkshuRuntime === null || topupScope === null || !ownerReady)
      return null;
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

    const restoreCashuTokens: RestoreCashuTokens = (mints) =>
      run(
        Effect.suspend(() => {
          const draft = decodeRestoreDraft({ mints });
          return Effect.flatMap(Restore, (restore) => restore.restore(draft));
        }),
      );

    const cashuTransferLifecycle: CashuTransferLifecycle = {
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
      resumePendingCashuAutoswapClaims,
      resumePendingCashuMelts,
      resumePendingCashuTopups,
      sendCashuToken,
      startCashuTopup,
    };
  }, [currentNsec, linkshuRuntime, ownerReady, topupScope]);

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
    resumePendingCashuAutoswapClaims:
      operations?.resumePendingCashuAutoswapClaims ?? null,
    resumePendingCashuMelts: operations?.resumePendingCashuMelts ?? null,
    resumePendingCashuTopups: operations?.resumePendingCashuTopups ?? null,
    sendCashuToken: operations?.sendCashuToken ?? null,
    startCashuTopup: operations?.startCashuTopup ?? null,
    walletBalances: readModel.balances,
    walletOperations: readModel.operations,
    walletProofs: readModel.proofs,
    walletTransfers: readModel.transfers,
  };
};
