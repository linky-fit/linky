import { Effect } from "effect";
import { InsufficientFunds, MintRejected } from "../domain/errors";
import { NonNegativeAmount, UnixSeconds } from "../domain/primitives";
import type { MintUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import type { CounterScope } from "../internal/counters";
import {
  insertOperation,
  inspectOperationWith,
  redactReceipt,
} from "../internal/operations";
import { insertProofs, toDomainProof, toNewProofs } from "../internal/proofs";
import {
  selectSpendableProofs,
  settleSwap,
  swapProofsForAmount,
} from "../internal/spend";
import { nowSeconds } from "../internal/time";
import { sat } from "../internal/units";
import {
  boundKeysetId,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { NewOperation, OperationStore } from "../ports/OperationStore";
import { ProofStore } from "../ports/ProofStore";
import { encodeCashuProofs } from "../token/internal/cashuProofs";
import { SendReceipt } from "./domain";
import type { SendDraft, SendError } from "./domain";

const malformedSwapProofs = (mint: MintUrl): MintRejected =>
  new MintRejected({
    mint,
    code: null,
    detail: "mint returned malformed proofs from the swap",
  });

/**
 * Sending is one call: select confirmed-unspent `available` proofs, swap the
 * amount out with disjoint send/keep deterministic counter blocks, persist
 * the send proofs as `handedOut` under a `send` transfer in the drafted
 * status and the change as `available`, then mark the consumed inputs
 * `spent`. Funds are never outside the store even when the caller crashes
 * mid-flow.
 */
export class Send extends Effect.Service<Send>()("linkshu/Send", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const proofStore = yield* ProofStore;
    const operationStore = yield* OperationStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;

    const send = (draft: SendDraft): Effect.Effect<SendReceipt, SendError> =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(draft.mint, sat);
        const keysetId = yield* boundKeysetId(draft.mint, wallet);
        const scope: CounterScope = { mint: draft.mint, unit: sat, keysetId };
        const spendContext = {
          proofStore,
          inspector,
          wallet,
          mint: draft.mint,
          unit: sat,
          reason: "send",
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
          { kv, inspector, wallet, scope },
          {
            amount: draft.amount,
            proofs: spendable.map(toDomainProof),
            available,
          },
        );
        const sendEncoded = encodeCashuProofs({
          mint: draft.mint,
          unit: sat,
          memo: draft.memo ?? null,
          proofs: swapped.send,
        });
        if (sendEncoded === null) {
          return yield* malformedSwapProofs(draft.mint);
        }

        // The transfer and its proofs land before the change and the
        // consumed inputs are booked, so a crash anywhere leaves every sat
        // accounted for.
        const transfer = yield* insertOperation(
          { operationStore, inspector },
          new NewOperation({
            kind: "send",
            status: draft.produceAs,
            mint: draft.mint,
            unit: sat,
            keysetId: null,
            amount: sendEncoded.amount,
            feeReserve: null,
            inputsTotal: null,
            quoteId: null,
            invoice: null,
            sourceMint: null,
            counter: null,
            locked: null,
            expiresAt: null,
            createdAt: UnixSeconds.make(yield* nowSeconds),
            tokenText: sendEncoded.tokenText,
            error: null,
          }),
          "send",
        );
        const handedOut = toNewProofs(
          swapped.send,
          draft.mint,
          sat,
          "handedOut",
          transfer.id,
        );
        if (handedOut === null) return yield* malformedSwapProofs(draft.mint);
        yield* insertProofs({ proofStore, inspector }, handedOut, "send");
        const outcome = yield* settleSwap(
          spendContext,
          spendable,
          swapped,
          "send-change",
        );
        if (outcome === null) return yield* malformedSwapProofs(draft.mint);
        const feePaid = available - sendEncoded.amount - outcome.keepAmount;
        if (feePaid < 0) return yield* malformedSwapProofs(draft.mint);

        return new SendReceipt({
          operationId: transfer.id,
          tokenText: sendEncoded.tokenText,
          proofs: sendEncoded.proofs,
          mint: draft.mint,
          unit: sat,
          amount: sendEncoded.amount,
          changeAmount: NonNegativeAmount.make(outcome.keepAmount),
          feePaid: NonNegativeAmount.make(feePaid),
        });
      }).pipe(
        inspectOperationWith(
          inspector,
          "send.send",
          {
            mint: draft.mint,
            amount: draft.amount,
            produceAs: draft.produceAs,
          },
          redactReceipt,
        ),
      );

    return { send } as const;
  }),
}) {}
