import { Context, Effect, Layer, Result } from "effect";
import {
  AmountConsumedByFee,
  EnvelopeBusy,
  EnvelopeNotFound,
  InsufficientFunds,
  MintRejected,
} from "../domain/errors";
import { Amount, NonNegativeAmount } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import {
  inspectOperation,
  inspectOperationWith,
  patchOperation,
  redactReceipt,
} from "../internal/operations";
import { setProofState, toDomainProof } from "../internal/proofs";
import {
  answerAt,
  checkProofStates,
  unspentProofs,
} from "../internal/proofStates";
import type { ProofAnswer } from "../internal/proofStates";
import {
  malformedSwapProofs,
  selectSpendableProofs,
  settleSwap,
  swapProofsForAmount,
} from "../internal/spend";
import { sat } from "../internal/units";
import { inputFeeForAmount } from "../mint/internal/keysetFees";
import {
  boundKeysetId,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import type { LoadedWallet } from "../mint/internal/WalletInstances";
import { CashuSeed } from "../ports/CashuSeed";
import { KeyValueStore } from "../ports/KeyValueStore";
import { OperationStore } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import type { StoredProof } from "../ports/ProofStore";
import { acceptAtMint } from "../receive/internal/acceptFlow";
import { encodeProofs, toDomainProofs } from "../token/internal/cashuProofs";
import {
  EnvelopeOpened,
  EnvelopeReleased,
  EnvelopeState,
  EnvelopeToken,
} from "./domain";
import type {
  EnvelopeOpenDraft,
  EnvelopeOpenError,
  EnvelopeRef,
  EnvelopeReleaseError,
  EnvelopeSendDraft,
  EnvelopeSendError,
  EnvelopeStateError,
  EnvelopeStatus,
} from "./domain";
import { envelopeOutputs, firstEnvelopeSecret } from "./internal/derivation";
import {
  closeIfSpent,
  heldRowsOf,
  isHandedOut,
  loadEnvelope,
  probeEnvelope,
  rowsOf,
  storeEnvelope,
  withEnvelopeLease,
} from "./internal/envelopes";
import type { LocalEnvelope } from "./internal/envelopes";

/**
 * Open here, or already out as a token (`issued`, or rows `handedOut` under
 * an operation a crash or a sync left `pending`). Rows a melt holds or the
 * mint spent rule it out.
 */
const isSendable = (
  envelope: LocalEnvelope,
  rows: ReadonlyArray<StoredProof>,
): boolean => {
  const { status, id } = envelope.operation;
  return (
    status === "issued" ||
    (status === "pending" &&
      rows.every(
        (proof) =>
          proof.state === "handedOut" ||
          (proof.state === "held" && proof.operationId === id),
      ))
  );
};

const statusOf = (
  answers: ReadonlyArray<ProofAnswer>,
): EnvelopeStatus | null => {
  if (answers.includes("unknown")) return null;
  if (answers.every((answer) => answer === "unspent")) return "unspent";
  if (answers.includes("pending")) return "pending";
  if (answers.every((answer) => answer === "spent")) return "spent";
  return "mixed";
};

/**
 * Envelopes: proofs a caller's key reserves, derived from the seed and the
 * key alone. Every device funding one key builds the same outputs, the mint
 * signs them once, and the losers adopt what the winner funded, so a key
 * pays at most once. Open envelopes hold their proofs `held` under an
 * `envelope` operation, out of the balance.
 */
export class Envelope extends Context.Service<Envelope>()("linkshu/Envelope", {
  make: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const proofStore = yield* ProofStore;
    const operationStore = yield* OperationStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;
    const { bip39Seed } = yield* CashuSeed;
    const ctx = { proofStore, operationStore, inspector };

    const findLocal = (ref: EnvelopeRef) =>
      loadEnvelope(ctx, ref.mint, firstEnvelopeSecret(bip39Seed, ref.key));

    /** Stores what the mint signed for the key; null when it signed nothing. */
    const adoptSigned = (wallet: LoadedWallet, ref: EnvelopeRef) =>
      Effect.flatMap(probeEnvelope(wallet, bip39Seed, ref), (signed) =>
        signed.length === 0
          ? Effect.succeed(null)
          : storeEnvelope(ctx, ref.mint, signed, "envelope-adopt"),
      );

    const loadOrAdopt = (wallet: LoadedWallet, ref: EnvelopeRef) =>
      Effect.flatMap(findLocal(ref), (local) =>
        local === null ? adoptSigned(wallet, ref) : Effect.succeed(local),
      );

    const opened = (
      outcome: EnvelopeOpened["outcome"],
      envelope: LocalEnvelope,
    ): EnvelopeOpened =>
      new EnvelopeOpened({
        outcome,
        operationId: envelope.operation.id,
        amount: envelope.operation.amount,
      });

    /**
     * Swaps `amount` into the envelope's outputs, change on the counter.
     * The swap stops on outputs the mint already signed, which only another
     * funding of the same key can have done.
     */
    const fund = (
      wallet: LoadedWallet,
      draft: EnvelopeOpenDraft,
    ): Effect.Effect<EnvelopeOpened, EnvelopeOpenError> =>
      Effect.gen(function* () {
        const keysetId = yield* boundKeysetId(draft.mint, wallet);
        // Whoever redeems or melts the envelope pays the input fee on it.
        const fee = inputFeeForAmount(wallet, draft.amount);
        if (draft.amount <= fee) {
          return yield* new AmountConsumedByFee({
            mint: draft.mint,
            amount: draft.amount,
            fee: Amount.make(fee),
          });
        }
        const spendContext = {
          proofStore,
          inspector,
          wallet,
          mint: draft.mint,
          unit: sat,
          reason: "envelope",
        };
        const { spendable, available } =
          yield* selectSpendableProofs(spendContext);
        if (available < draft.amount) {
          return yield* new InsufficientFunds({
            mint: draft.mint,
            required: draft.amount,
            available: NonNegativeAmount.make(available),
          });
        }
        const swapped = yield* swapProofsForAmount(
          {
            kv,
            inspector,
            wallet,
            scope: { mint: draft.mint, unit: sat, keysetId },
          },
          {
            amount: draft.amount,
            proofs: spendable.map(toDomainProof),
            available,
            fixedSend: {
              outputs: envelopeOutputs(
                bip39Seed,
                draft.key,
                draft.amount,
                keysetId,
              ),
              alreadySigned: probeEnvelope(wallet, bip39Seed, draft).pipe(
                Effect.map((signed) => signed.length > 0),
                Effect.orElseSucceed(() => false),
              ),
            },
          },
        );
        const proofs = toDomainProofs(swapped.send);
        if (proofs === null) return yield* malformedSwapProofs(draft.mint);
        // The envelope lands before the change and the consumed inputs are
        // booked, so a crash anywhere leaves every sat accounted for.
        const envelope = yield* storeEnvelope(
          ctx,
          draft.mint,
          proofs,
          "envelope",
        );
        const settled = yield* settleSwap(
          spendContext,
          spendable,
          swapped,
          "envelope-change",
        );
        if (settled === null) return yield* malformedSwapProofs(draft.mint);
        return opened("created", envelope);
      });

    const open = (
      draft: EnvelopeOpenDraft,
    ): Effect.Effect<EnvelopeOpened, EnvelopeOpenError> =>
      withEnvelopeLease(
        kv,
        draft,
      )(
        Effect.gen(function* () {
          const local = yield* findLocal(draft);
          if (local !== null) return opened("adopted", local);
          const wallet = yield* instances.get(draft.mint, sat);
          const signed = yield* adoptSigned(wallet, draft);
          if (signed !== null) return opened("adopted", signed);
          const funded = yield* Effect.result(fund(wallet, draft));
          if (Result.isSuccess(funded)) return funded.success;
          // Another device funding the key in the meantime makes this swap
          // fail on its outputs or on synced inputs; the envelope is theirs.
          const raced = yield* Effect.orElseSucceed(
            adoptSigned(wallet, draft),
            () => null,
          );
          return raced === null
            ? yield* Effect.fail(funded.failure)
            : opened("adopted", raced);
        }),
      ).pipe(
        inspectOperation(inspector, "envelope.open", {
          mint: draft.mint,
          key: draft.key,
          amount: draft.amount,
        }),
      );

    /** Marks the envelope's rows the mint reported spent; closes it when all are. */
    const settleSpent = (
      envelope: LocalEnvelope,
      answers: ReadonlyArray<ProofAnswer>,
    ) =>
      Effect.gen(function* () {
        const spentSecrets = new Set(
          envelope.proofs
            .filter((_, index) => answers[index] === "spent")
            .map((proof) => proof.secret),
        );
        const rows = rowsOf(yield* proofStore.loadAll, envelope).filter(
          (proof) => proof.state !== "spent" && spentSecrets.has(proof.secret),
        );
        yield* setProofState(ctx, rows, "spent", "envelope-spent");
        yield* closeIfSpent(ctx, envelope, "envelope-spent");
      });

    const stateOf = (
      wallet: LoadedWallet,
      ref: EnvelopeRef,
    ): Effect.Effect<EnvelopeState, EnvelopeStateError> =>
      Effect.gen(function* () {
        const envelope = yield* loadOrAdopt(wallet, ref);
        if (envelope === null) {
          return new EnvelopeState({
            status: "absent",
            amount: NonNegativeAmount.make(0),
            operationId: null,
          });
        }
        const states = yield* checkProofStates(
          wallet,
          ref.mint,
          envelope.proofs,
        );
        const answers = envelope.proofs.map((_, index) =>
          answerAt(states, index),
        );
        const status = statusOf(answers);
        if (status === null) {
          return yield* new MintRejected({
            mint: ref.mint,
            code: null,
            detail: "mint did not report the state of every envelope proof",
          });
        }
        yield* settleSpent(envelope, answers);
        return new EnvelopeState({
          status,
          amount: NonNegativeAmount.make(envelope.operation.amount),
          operationId: envelope.operation.id,
        });
      });

    const state = (
      ref: EnvelopeRef,
    ): Effect.Effect<EnvelopeState, EnvelopeStateError> =>
      Effect.flatMap(instances.get(ref.mint, sat), (wallet) =>
        stateOf(wallet, ref),
      ).pipe(
        inspectOperation(inspector, "envelope.state", {
          mint: ref.mint,
          key: ref.key,
        }),
      );

    /**
     * The envelope as token text, carrying `memo`; its proofs become
     * `handedOut`. Every device produces the same text for the same memo,
     * and sending it again returns it again, also after a crash halfway
     * through.
     */
    const send = (
      draft: EnvelopeSendDraft,
    ): Effect.Effect<EnvelopeToken, EnvelopeSendError> =>
      withEnvelopeLease(
        kv,
        draft,
      )(
        Effect.gen(function* () {
          const ref = { mint: draft.mint, key: draft.key };
          const envelope = yield* findLocal(ref);
          if (envelope === null) return yield* new EnvelopeNotFound(ref);
          const proofs = yield* proofStore.loadAll;
          if (!isSendable(envelope, rowsOf(proofs, envelope))) {
            return yield* new EnvelopeNotFound(ref);
          }
          const { operation } = envelope;
          yield* setProofState(
            ctx,
            heldRowsOf(proofs, envelope),
            "handedOut",
            "envelope-send",
          );
          if (operation.status !== "issued") {
            yield* patchOperation(
              ctx,
              operation,
              { status: "issued" },
              "envelope-send",
            );
          }
          const withMemo =
            draft.memo === undefined
              ? null
              : encodeProofs({
                  mint: draft.mint,
                  unit: sat,
                  memo: draft.memo,
                  proofs: envelope.proofs,
                });
          return new EnvelopeToken({
            operationId: operation.id,
            tokenText: withMemo?.tokenText ?? envelope.tokenText,
            amount: operation.amount,
          });
        }),
      ).pipe(
        inspectOperationWith(
          inspector,
          "envelope.send",
          { mint: draft.mint, key: draft.key },
          redactReceipt,
        ),
      );

    /**
     * Swaps the envelope's unspent proofs back into the balance; its
     * proofs die at the mint and it closes `returned`. An envelope handed
     * out as a token is its recipient's, so it releases nothing.
     */
    const release = (
      ref: EnvelopeRef,
    ): Effect.Effect<EnvelopeReleased, EnvelopeReleaseError> =>
      withEnvelopeLease(
        kv,
        ref,
      )(
        Effect.gen(function* () {
          const nothing = new EnvelopeReleased({
            amount: NonNegativeAmount.make(0),
          });
          const wallet = yield* instances.get(ref.mint, sat);
          const envelope = yield* loadOrAdopt(wallet, ref);
          if (
            envelope === null ||
            isHandedOut(envelope, rowsOf(yield* proofStore.loadAll, envelope))
          ) {
            return nothing;
          }
          const states = yield* checkProofStates(
            wallet,
            ref.mint,
            envelope.proofs,
          );
          const answers = envelope.proofs.map((_, index) =>
            answerAt(states, index),
          );
          if (answers.includes("pending")) {
            return yield* new EnvelopeBusy(ref);
          }
          yield* settleSpent(envelope, answers);
          const unspent = unspentProofs(envelope.proofs, states);
          const encoded = encodeProofs({
            mint: ref.mint,
            unit: sat,
            memo: null,
            proofs: unspent,
          });
          if (encoded === null) return nothing;
          const accepted = yield* acceptAtMint(
            { kv, proofStore, operationStore, instances, inspector },
            wallet,
            { ...encoded, mint: ref.mint, unit: sat, memo: null },
            "envelope-release",
          );
          const released = new Set(unspent.map((proof) => proof.secret));
          yield* setProofState(
            ctx,
            rowsOf(yield* proofStore.loadAll, envelope).filter((proof) =>
              released.has(proof.secret),
            ),
            "spent",
            "envelope-release",
          );
          yield* patchOperation(
            ctx,
            envelope.operation,
            { status: "returned" },
            "envelope-release",
          );
          return new EnvelopeReleased({
            amount: NonNegativeAmount.make(accepted.amount),
          });
        }),
      ).pipe(
        inspectOperation(inspector, "envelope.release", {
          mint: ref.mint,
          key: ref.key,
        }),
      );

    return { open, state, send, release } as const;
  }),
}) {
  static readonly layerWithoutDependencies = Layer.effect(this, this.make);
  static readonly layer = this.layerWithoutDependencies.pipe(
    Layer.provide(WalletInstances.layer),
  );
}
