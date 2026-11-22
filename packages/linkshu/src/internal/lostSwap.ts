import type { OutputDataLike, SwapPreview } from "@cashu/cashu-ts";
import { Effect, Schema } from "effect";
import { MintRejected } from "../domain/errors";
import type { MintUnreachable } from "../domain/errors";
import type { InspectorService } from "../inspector/Inspector";
import { classifyMintError } from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import type { KeyValueStoreService } from "../ports/KeyValueStore";
import type { ProofStoreService } from "../ports/ProofStore";
import { KeysetId } from "../domain/primitives";
import type { Proof } from "../token/domain";
import { toDomainProofs } from "../token/internal/cashuProofs";
import { advanceCounterTo, scopeSuffix } from "./counters";
import type { CounterScope } from "./counters";
import { bookProofs, domainToNewProofs, knownSecretsOf } from "./proofs";
import { answerAt, checkProofStates, unspentProofs } from "./proofStates";

/**
 * A spend swap whose response never arrived may still have run at the mint.
 * Before the request leaves, the attempt's exact inputs and the counter slots
 * and amounts of its deterministic outputs are recorded device-locally. The
 * mint runs a swap atomically, so the outputs are this attempt's only when
 * every input is spent and every recorded slot holds a signature of the
 * recorded amount; anything else in those slots was signed for another
 * request (another device on the seed) and is never imported.
 */

export const LOST_SWAP_KEY_PREFIX = "linkshu.lostSwap.";

const SlotRun = Schema.Struct({
  counter: Schema.Finite,
  amounts: Schema.Array(Schema.Finite),
});
type SlotRun = typeof SlotRun.Type;

class SwapAttempt extends Schema.Class<SwapAttempt>("SwapAttempt")({
  inputs: Schema.Array(
    Schema.Struct({ id: KeysetId, secret: Schema.NonEmptyString }),
  ),
  outputs: Schema.Array(SlotRun),
}) {}

const encodeAttempt = Schema.encodeSync(Schema.fromJsonString(SwapAttempt));
const decodeAttempt = Schema.decodeUnknownOption(
  Schema.fromJsonString(SwapAttempt),
);

const attemptKey = (scope: CounterScope): string =>
  LOST_SWAP_KEY_PREFIX + scopeSuffix(scope);

export interface LostSwapContext {
  readonly kv: KeyValueStoreService;
  readonly proofStore: ProofStoreService;
  readonly inspector: InspectorService;
  readonly wallet: LoadedWallet;
  readonly scope: CounterScope;
}

const slotRun = (
  counter: number,
  outputs: ReadonlyArray<OutputDataLike> = [],
): SlotRun => ({
  counter,
  amounts: outputs.map((output) => output.blindedMessage.amount.toNumber()),
});

/**
 * Records `preview` before its request leaves. `sendCounter` is null when the
 * send outputs are not counter-derived (P2PK, envelope).
 */
export const recordSwapAttempt = (
  ctx: LostSwapContext,
  offered: ReadonlyArray<Proof>,
  preview: SwapPreview,
  sendCounter: number | null,
  keepCounter: number,
): Effect.Effect<void> => {
  const inputSecrets = new Set(preview.inputs.map((input) => input.secret));
  const runs = [
    ...(sendCounter === null
      ? []
      : [slotRun(sendCounter, preview.sendOutputs)]),
    slotRun(keepCounter, preview.keepOutputs),
  ];
  return ctx.kv.set(
    attemptKey(ctx.scope),
    encodeAttempt(
      new SwapAttempt({
        inputs: offered
          .filter((proof) => inputSecrets.has(proof.secret))
          .map(({ id, secret }) => ({ id, secret })),
        outputs: runs.filter((run) => run.amounts.length > 0),
      }),
    ),
  );
};

export const hasSwapAttempt = (
  kv: KeyValueStoreService,
  scope: CounterScope,
): Effect.Effect<boolean> =>
  Effect.map(kv.get(attemptKey(scope)), (raw) => raw !== null);

export const removeSwapAttempt = (
  ctx: Pick<LostSwapContext, "kv" | "scope">,
): Effect.Effect<void> => ctx.kv.remove(attemptKey(ctx.scope));

const sortedAmounts = (amounts: ReadonlyArray<number>): string =>
  [...amounts].sort((a, b) => a - b).join(",");

/** The proofs signed at `outputs`, or none unless every run matches its record. */
const restoreAttemptOutputs = (
  ctx: LostSwapContext,
  outputs: ReadonlyArray<SlotRun>,
): Effect.Effect<ReadonlyArray<Proof>, MintUnreachable | MintRejected> =>
  Effect.gen(function* () {
    const { mint, keysetId } = ctx.scope;
    const restored: Proof[] = [];
    for (const run of outputs) {
      const { proofs } = yield* Effect.tryPromise({
        try: () =>
          ctx.wallet.restore(run.counter, run.amounts.length, { keysetId }),
        catch: (error) => classifyMintError(mint, error),
      });
      const decoded = toDomainProofs(proofs);
      if (decoded === null) {
        return yield* new MintRejected({
          mint,
          code: null,
          detail: "mint returned malformed proofs from the restore",
        });
      }
      const amounts = decoded.map((proof) => proof.amount);
      if (sortedAmounts(amounts) !== sortedAmounts(run.amounts)) return [];
      restored.push(...decoded);
    }
    return restored;
  });

/**
 * Settles a recorded swap attempt. Every input spent: the outputs the attempt
 * owns that the store lacks and the mint reports unspent are stored
 * `available` in one write with the inputs moved to `spent`, and the counter
 * moves past the attempt's slots. An input unspent: the swap never ran (a
 * running one reports its inputs pending), so the record is dropped. Pending
 * or unanswered inputs keep the record; the result is then `false`, and the
 * caller must not overwrite it. Caller must hold the counter lock.
 */
export const reclaimLostSwap = (
  ctx: LostSwapContext,
): Effect.Effect<boolean, MintUnreachable> =>
  Effect.gen(function* () {
    const { mint, unit } = ctx.scope;
    const raw = yield* ctx.kv.get(attemptKey(ctx.scope));
    if (raw === null) return true;
    const decoded = decodeAttempt(raw);
    if (decoded._tag === "None") {
      yield* removeSwapAttempt(ctx);
      return true;
    }
    const { inputs, outputs } = decoded.value;
    const states = yield* checkProofStates(ctx.wallet, mint, inputs);
    const answers = inputs.map((_, index) => answerAt(states, index));
    if (
      answers.some((answer) => answer === "pending" || answer === "unknown")
    ) {
      return false;
    }
    if (answers.length === 0 || answers.includes("unspent")) {
      yield* removeSwapAttempt(ctx);
      return true;
    }
    const owned = yield* restoreAttemptOutputs(ctx, outputs).pipe(
      Effect.catchTag("MintRejected", () => Effect.succeed([])),
    );
    const known = yield* knownSecretsOf(ctx.proofStore, owned);
    const unstored = owned.filter((proof) => !known.has(proof.secret));
    const unspent = unspentProofs(
      unstored,
      yield* checkProofStates(ctx.wallet, mint, unstored),
    );
    const spentInputs = (yield* ctx.proofStore.findBySecrets(
      inputs.map((input) => input.secret),
    )).filter((proof) => proof.state === "available");
    yield* bookProofs(
      ctx,
      [
        {
          proofs: domainToNewProofs(unspent, mint, unit, "available", null),
          reason: "swap-reclaim",
        },
      ],
      [
        {
          proofs: spentInputs,
          state: "spent",
          reason: "swap-reclaim",
          operationId: null,
        },
      ],
    );
    yield* advanceCounterTo(
      ctx.kv,
      ctx.inspector,
      ctx.scope,
      Math.max(0, ...outputs.map((run) => run.counter + run.amounts.length)),
      "restore",
    );
    yield* removeSwapAttempt(ctx);
    return true;
  }).pipe(Effect.catchTag("MintRejected", () => Effect.succeed(false)));
