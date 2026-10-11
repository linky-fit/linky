import {
  Autoswap,
  AutoswapDraft,
  Envelope,
  EnvelopeMeltDraft,
  EnvelopeOpenDraft,
  EnvelopeRef,
  EnvelopeSendDraft,
  FeeProbe,
  FeeProbeDraft,
  Melt,
  MeltDraft,
  Mints,
  MintUnreachable,
  MintUrl,
  OperationId,
  PaidQuoteDraft,
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
} from "@linky-fit/linkshu";
import type {
  AutoswapClaimResult,
  AutoswapError,
  AutoswapEstimate,
  AutoswapEstimateError,
  AutoswapReceipt,
  CounterLockTimeout,
  DeferredReceiveResult,
  EnvelopeMeltError,
  EnvelopeOpened,
  EnvelopeOpenError,
  EnvelopeReleased,
  EnvelopeReleaseError,
  EnvelopeSendError,
  EnvelopeState,
  EnvelopeStateError,
  EnvelopeToken,
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
  MintInfo,
  MintRejected,
  NewOperation,
  OperationNotFound,
  ProofStateSnapshot,
  ReceiveError,
  ReceiveReceipt,
  ReceiveUnlockOptions,
  ReclaimReport,
  RestoreReport,
  RestoreProgress,
  SendError,
  SendReceipt,
  TopupAdoptError,
  TopupError,
  TopupHandle,
  TopupQuote,
  TopupLockingOptions,
  TopupReceipt,
  TransferCheckResult,
  ValidationReport,
  WalletBalances,
} from "@linky-fit/linkshu";
import { Effect, Schema, Scope } from "effect";
import type { Result } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { storedMintSpelling } from "../../lib/mintSpelling";
import {
  linkshuRuntimeAtom,
  NostrKeyOptions,
  WalletScope,
  type LinkshuEnv,
} from "./runtime";

/**
 * linkshu Receive; resolves with the typed outcome, only defects reject.
 * `automatic` when the app, not the user, started it.
 */
export type ReceiveCashuToken = (
  text: string,
  options?: { readonly automatic?: boolean },
) => Promise<Result.Result<ReceiveReceipt, ReceiveError>>;

interface SendCashuTokenArgs {
  readonly amountSat: number;
  /** The token's memo (NUT-00), shown to whoever receives it. */
  readonly memo?: string | null;
  readonly mint: string;
  /** `issued` for QR/share (claim-watched), `pending` for messenger sends. */
  readonly produceAs: "issued" | "pending";
}

/** linkshu Send; invalid mint/amount input and defects reject. */
export type SendCashuToken = (
  args: SendCashuTokenArgs,
) => Promise<Result.Result<SendReceipt, SendError>>;

interface MeltCashuInvoiceArgs {
  readonly invoice: string;
  readonly mint: string;
}

/** linkshu Melt; invalid mint/invoice input and defects reject. */
export type MeltCashuInvoice = (
  args: MeltCashuInvoiceArgs,
) => Promise<Result.Result<MeltReceipt, MeltError>>;

export interface CashuEnvelopeRef {
  readonly mint: string;
  readonly key: string;
}

/**
 * linkshu `Envelope` and `Melt.meltEnvelope`; invalid mint/key input and
 * defects reject.
 */
export interface CashuEnvelopes {
  readonly open: (
    args: CashuEnvelopeRef & { readonly amountSat: number },
  ) => Promise<Result.Result<EnvelopeOpened, EnvelopeOpenError>>;
  readonly state: (
    ref: CashuEnvelopeRef,
  ) => Promise<Result.Result<EnvelopeState, EnvelopeStateError>>;
  readonly send: (
    args: CashuEnvelopeRef & { readonly memo: string | null },
  ) => Promise<Result.Result<EnvelopeToken, EnvelopeSendError>>;
  readonly melt: (
    args: CashuEnvelopeRef & { readonly invoice: string },
  ) => Promise<Result.Result<MeltReceipt, EnvelopeMeltError>>;
  readonly release: (
    ref: CashuEnvelopeRef,
  ) => Promise<Result.Result<EnvelopeReleased, EnvelopeReleaseError>>;
}

/** Retries tokens kept for an unreachable mint (linkshu `Receive.resumeDeferred`). */
export type ResumeDeferredCashuReceives = () => Promise<
  ReadonlyArray<DeferredReceiveResult>
>;

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
) => Promise<Result.Result<LightningFeeProbeResult, FeeProbeError>>;

/**
 * linkshu `Mints.fetchInfo`, given up after 8 s; the mint stays out of the
 * wallet's known mints. Invalid mint input and defects reject.
 */
export type FetchMintInfo = (
  mint: string,
) => Promise<Result.Result<MintInfo, MintUnreachable | MintRejected>>;

interface StartCashuTopupArgs {
  readonly amountSat: number;
  /** The invoice's bolt11 description, when the mint supports one. */
  readonly description?: string | null;
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
  readonly completion: Promise<Result.Result<TopupReceipt, TopupError>>;
}

/** linkshu Topup start; invalid mint/amount input and defects reject. */
export type StartCashuTopup = (
  args: StartCashuTopupArgs,
) => Promise<Result.Result<CashuTopupHandle, MintUnreachable | MintRejected>>;

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
) => Promise<Result.Result<TopupReceipt, TopupAdoptError>>;

interface AutoswapCashuArgs {
  readonly sourceMint: string;
  readonly targetMint: string;
  /** What the target mint issues; omitted sweeps the whole source balance. */
  readonly amountSat?: number;
}

/**
 * The spelling linkshu holds a mint's funds under. A move resolves it once
 * and hands the same source to the estimate and the claim.
 */
export type ResolveAutoswapSource = (mint: string) => Promise<string>;

/** linkshu Autoswap claim; invalid mint/amount input and defects reject. */
export type AutoswapCashu = (
  args: AutoswapCashuArgs,
) => Promise<Result.Result<AutoswapReceipt, AutoswapError>>;

/**
 * linkshu Autoswap estimate; pays nothing. Without `amountSat` it prices the
 * sweep's first attempt. Invalid input and defects reject.
 */
export type EstimateAutoswapCashu = (
  args: AutoswapCashuArgs,
) => Promise<Result.Result<AutoswapEstimate, AutoswapEstimateError>>;

/** Drains persisted pending claims (linkshu `Autoswap.resumePendingClaims`). */
export type ResumePendingCashuAutoswapClaims = () => Promise<
  ReadonlyArray<AutoswapClaimResult>
>;

/** The wallet's balances as stored now (`Tokens.balances`), test mints included. */
export type ReadWalletBalances = () => Promise<WalletBalances>;

/** Read-only mint status of every unspent proof, for the Tokens page. */
export type InspectCashuProofStates = () => Promise<
  ReadonlyArray<ProofStateSnapshot>
>;

/** linkshu `Validation.checkAll` over the inventory; only defects reject. */
export type CheckAllCashuTokens = () => Promise<ValidationReport>;

/** NUT-07 check of one transfer (linkshu `Validation.checkTransfer`). */
export type CheckCashuTransfer = (
  operationId: string,
) => Promise<Result.Result<TransferCheckResult, OperationNotFound>>;

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
  ) => Promise<
    Result.Result<void, TransferTransitionError | CounterLockTimeout>
  >;
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
  ) => Promise<Result.Result<void, TransferTransitionError>>;
  readonly markIssued: (
    operationId: string,
  ) => Promise<Result.Result<void, TransferTransitionError>>;
  /** Re-receives a handed-out token, or retries a failed receive. */
  readonly returnToWallet: (
    operationId: string,
  ) => Promise<
    Result.Result<ReceiveReceipt, ReceiveError | TransferTransitionError>
  >;
}

const decodeAutoswapDraft = Schema.decodeUnknownSync(AutoswapDraft);
const decodeSendDraft = Schema.decodeUnknownSync(SendDraft);
const decodeMeltDraft = Schema.decodeUnknownSync(MeltDraft);
const decodeFeeProbeDraft = Schema.decodeUnknownSync(FeeProbeDraft);
const decodeRestoreDraft = Schema.decodeUnknownSync(RestoreDraft);
const decodeTopupDraft = Schema.decodeUnknownSync(TopupDraft);
const decodePaidQuoteDraft = Schema.decodeUnknownSync(PaidQuoteDraft);
const decodeEnvelopeRef = Schema.decodeUnknownSync(EnvelopeRef);
const decodeMintUrl = Schema.decodeUnknownSync(MintUrl);
const decodeEnvelopeOpenDraft = Schema.decodeUnknownSync(EnvelopeOpenDraft);
const decodeEnvelopeMeltDraft = Schema.decodeUnknownSync(EnvelopeMeltDraft);
const decodeEnvelopeSendDraft = Schema.decodeUnknownSync(EnvelopeSendDraft);

/** `mint` as the spelling linkshu stored its funds under (`storedMintSpelling`). */
export const storedSourceMint = (mint: string) =>
  Effect.map(
    Effect.flatMap(Tokens, (tokens) => tokens.balances),
    ({ perMint }) => storedMintSpelling(perMint, mint),
  );

/**
 * Runs an operation on the linkshu runtime, detached from whoever called it:
 * concurrent calls each get their own outcome, and nothing a screen does
 * (unmounting included) interrupts one.
 */
type LinkshuRun = <A, E>(
  operation: Effect.Effect<A, E, LinkshuEnv>,
) => Promise<A>;

/** The wallet operations the app runs, as promises over `run`. */
const makeLinkshuCommands = (run: LinkshuRun) => {
  const runResult = <A, E>(
    effect: Effect.Effect<A, E, LinkshuEnv>,
  ): Promise<Result.Result<A, E>> => run(Effect.result(effect));
  const withTopup = <A, E>(
    use: (
      topup: Topup["Service"],
      locking: TopupLockingOptions,
      pollingScope: Scope.Scope,
    ) => Effect.Effect<A, E>,
  ) =>
    Effect.gen(function* () {
      const { lockingOptions } = yield* NostrKeyOptions;
      return yield* use(yield* Topup, lockingOptions, yield* WalletScope);
    });
  const operationId = (id: string) => OperationId.make(id);

  const toHandle = (handle: TopupHandle): CashuTopupHandle => {
    const completion = runResult(handle.result);
    // Rejection means the runtime shut down mid-poll; an unwatched handle
    // must not surface that as an unhandled rejection.
    completion.catch(() => {});
    return { quote: handle.quote, completion };
  };

  const withUnlockOptions = <A, E, R>(
    use: (unlockOptions: ReceiveUnlockOptions) => Effect.Effect<A, E, R>,
  ) =>
    Effect.flatMap(NostrKeyOptions, ({ unlockOptions }) => use(unlockOptions));

  const receiveCashuToken: ReceiveCashuToken = (text, options) =>
    runResult(
      withUnlockOptions((unlockOptions) =>
        Effect.flatMap(Receive, (receive) =>
          receive.receive(
            new ReceiveDraft({ text, automatic: options?.automatic === true }),
            unlockOptions,
          ),
        ),
      ),
    );

  const resumeDeferredCashuReceives: ResumeDeferredCashuReceives = () =>
    run(
      withUnlockOptions((unlockOptions) =>
        Effect.flatMap(Receive, (receive) =>
          receive.resumeDeferred(unlockOptions),
        ),
      ),
    );

  const sendCashuToken: SendCashuToken = ({
    amountSat,
    memo,
    mint,
    produceAs,
  }) =>
    runResult(
      Effect.suspend(() => {
        const draft = decodeSendDraft({
          amount: amountSat,
          mint,
          produceAs,
          ...(memo ? { memo } : {}),
        });
        return Effect.flatMap(Send, (send) => send.send(draft));
      }),
    );

  const meltCashuInvoice: MeltCashuInvoice = ({ invoice, mint }) =>
    runResult(
      Effect.suspend(() => {
        const draft = decodeMeltDraft({ invoice, mint });
        return Effect.flatMap(Melt, (melt) => melt.melt(draft));
      }),
    );

  const resumePendingCashuMelts: ResumePendingCashuMelts = () =>
    run(Effect.flatMap(Melt, (melt) => melt.resumePending));

  const startCashuTopup: StartCashuTopup = ({ amountSat, description, mint }) =>
    runResult(
      Effect.suspend(() => {
        const draft = decodeTopupDraft({
          mint,
          amount: amountSat,
          ...(description ? { description } : {}),
        });
        return withTopup((topup, locking, scope) =>
          Scope.provide(topup.start(draft, locking), scope),
        );
      }).pipe(Effect.map(toHandle)),
    );

  const resumePendingCashuTopups: ResumePendingCashuTopups = () =>
    run(
      withTopup((topup, locking, scope) =>
        Scope.provide(topup.resumePending(locking), scope),
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
    runResult(
      Effect.suspend(() => {
        const draft = decodePaidQuoteDraft({
          mint,
          quoteId,
          amount: amountSat,
          invoice,
          expiresAt,
          locked,
        });
        return withTopup((topup, locking) => topup.adopt(draft, locking));
      }),
    );

  const resolveAutoswapSource: ResolveAutoswapSource = (mint) =>
    run(storedSourceMint(mint));

  const autoswapCashu: AutoswapCashu = ({
    sourceMint,
    targetMint,
    amountSat,
  }) =>
    runResult(
      Effect.suspend(() => {
        const draft = decodeAutoswapDraft({
          sourceMint,
          targetMint,
          ...(amountSat === undefined ? {} : { amount: amountSat }),
        });
        return Effect.flatMap(Autoswap, (autoswap) => autoswap.claim(draft));
      }),
    );

  const estimateAutoswapCashu: EstimateAutoswapCashu = ({
    sourceMint,
    targetMint,
    amountSat,
  }) =>
    runResult(
      Effect.suspend(() => {
        const draft = decodeAutoswapDraft({
          sourceMint,
          targetMint,
          ...(amountSat === undefined ? {} : { amount: amountSat }),
        });
        return Effect.flatMap(Autoswap, (autoswap) => autoswap.estimate(draft));
      }),
    );

  const resumePendingCashuAutoswapClaims: ResumePendingCashuAutoswapClaims =
    () =>
      run(Effect.flatMap(Autoswap, (autoswap) => autoswap.resumePendingClaims));

  const probeLightningFee: ProbeLightningFee = ({ mint, probeMint }) =>
    runResult(
      Effect.suspend(() => {
        const draft = decodeFeeProbeDraft({ mint, probeMint });
        return Effect.flatMap(FeeProbe, (feeProbe) =>
          feeProbe.probeLightningFee(draft),
        );
      }),
    );

  const fetchMintInfo: FetchMintInfo = (mint) =>
    runResult(
      Effect.suspend(() => {
        const url = decodeMintUrl(mint);
        return Effect.flatMap(Mints, (mints) => mints.fetchInfo(url)).pipe(
          Effect.timeoutOrElse({
            duration: "8 seconds",
            orElse: () =>
              Effect.fail(
                new MintUnreachable({
                  mint: url,
                  detail: "mint info did not arrive within 8 s",
                }),
              ),
          }),
        );
      }),
    );

  const readWalletBalances: ReadWalletBalances = () =>
    run(Effect.flatMap(Tokens, (tokens) => tokens.balances));

  const inspectCashuProofStates: InspectCashuProofStates = () =>
    run(
      Effect.flatMap(Validation, (validation) => validation.inspectProofStates),
    );

  const checkAllCashuTokens: CheckAllCashuTokens = () =>
    run(Effect.flatMap(Validation, (validation) => validation.checkAll));

  const checkCashuTransfer: CheckCashuTransfer = (id) =>
    runResult(
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

  const withEnvelope = <A, E>(
    ref: CashuEnvelopeRef,
    use: (
      envelope: Envelope["Service"],
      decoded: EnvelopeRef,
    ) => Effect.Effect<A, E>,
  ): Promise<Result.Result<A, E>> =>
    runResult(
      Effect.suspend(() => {
        const decoded = decodeEnvelopeRef(ref);
        return Effect.flatMap(Envelope, (envelope) => use(envelope, decoded));
      }),
    );

  const cashuEnvelopes: CashuEnvelopes = {
    open: ({ mint, key, amountSat }) =>
      runResult(
        Effect.suspend(() => {
          const draft = decodeEnvelopeOpenDraft({
            mint,
            key,
            amount: amountSat,
          });
          return Effect.flatMap(Envelope, (envelope) => envelope.open(draft));
        }),
      ),
    state: (ref) =>
      withEnvelope(ref, (envelope, decoded) => envelope.state(decoded)),
    send: ({ mint, key, memo }) =>
      runResult(
        Effect.suspend(() => {
          const draft = decodeEnvelopeSendDraft({
            mint,
            key,
            ...(memo === null ? {} : { memo }),
          });
          return Effect.flatMap(Envelope, (envelope) => envelope.send(draft));
        }),
      ),
    melt: ({ mint, key, invoice }) =>
      runResult(
        Effect.suspend(() => {
          const draft = decodeEnvelopeMeltDraft({ mint, key, invoice });
          return Effect.flatMap(Melt, (melt) => melt.meltEnvelope(draft));
        }),
      ),
    release: (ref) =>
      withEnvelope(ref, (envelope, decoded) => envelope.release(decoded)),
  };

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
                (proof.state === "handedOut" || proof.state === "externalized"),
            )
            .map((proof) => proof.id);
          return yield* tokens.reclaim(ids);
        }),
      ),
    checkIssuedClaims: () =>
      run(Effect.flatMap(Validation, (validation) => validation.checkIssued)),
    forget: (id) =>
      runResult(
        Effect.flatMap(Tokens, (tokens) => tokens.forget(operationId(id))),
      ),
    importProofs: (drafts) =>
      run(Effect.flatMap(Tokens, (tokens) => tokens.importProofs(drafts))),
    importOperation: (draft) =>
      run(Effect.flatMap(Tokens, (tokens) => tokens.importOperation(draft))),
    importLegacyRows: (rows) =>
      run(Effect.flatMap(Tokens, (tokens) => tokens.ingestLegacyRows(rows))),
    markExternalized: (id) =>
      runResult(
        Effect.flatMap(Tokens, (tokens) =>
          tokens.markExternalized(operationId(id)),
        ),
      ),
    markIssued: (id) =>
      runResult(
        Effect.flatMap(Tokens, (tokens) => tokens.markIssued(operationId(id))),
      ),
    returnToWallet: (id) =>
      runResult(
        withUnlockOptions((unlockOptions) =>
          Effect.flatMap(Tokens, (tokens) =>
            tokens.returnToWallet(operationId(id), unlockOptions),
          ),
        ),
      ),
  };

  return {
    adoptPaidCashuQuote,
    autoswapCashu,
    cashuEnvelopes,
    cashuTransferLifecycle,
    checkAllCashuTokens,
    inspectCashuProofStates,
    checkCashuTransfer,
    estimateAutoswapCashu,
    fetchMintInfo,
    meltCashuInvoice,
    probeLightningFee,
    readWalletBalances,
    receiveCashuToken,
    restoreCashuTokens,
    reclaimCashuTokens,
    resolveAutoswapSource,
    resumeDeferredCashuReceives,
    resumePendingCashuAutoswapClaims,
    resumePendingCashuMelts,
    resumePendingCashuTopups,
    sendCashuToken,
    startCashuTopup,
  };
};

/**
 * The commands over the current linkshu runtime. These are not `Atom.fn`
 * atoms: a concurrent fn atom hands every caller the oldest running call's
 * result, and it re-runs its last call when the runtime rebuilds.
 */
export const linkshuCommandsAtom = Atom.readable((get) =>
  AsyncResult.map(get(linkshuRuntimeAtom), (context) =>
    makeLinkshuCommands(Effect.runPromiseWith(context)),
  ),
);

export type LinkshuCommands = ReturnType<typeof makeLinkshuCommands>;
