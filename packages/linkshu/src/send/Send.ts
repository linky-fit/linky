import { Effect } from "effect";
import { InsufficientFunds, MintRejected } from "../domain/errors";
import { NonNegativeAmount } from "../domain/primitives";
import type { MintUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import type { CounterScope } from "../internal/counters";
import { inspectOperationWith, redactReceipt } from "../internal/operations";
import { sat } from "../internal/units";
import {
  removeConsumedRows,
  selectSpendableProofs,
  swapProofsForAmount,
} from "../internal/spend";
import {
  boundKeysetId,
  WalletInstances,
} from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import { encodeCashuProofs } from "../token/internal/cashuProofs";
import { insertRowInState } from "../token/internal/lifecycle";
import { SendReceipt } from "./domain";
import type { SendDraft, SendError } from "./domain";

const malformedSwapProofs = (mint: MintUrl): MintRejected =>
  new MintRejected({
    mint,
    code: null,
    detail: "mint returned malformed proofs from the swap",
  });

/**
 * Sending is one call: select the mint's `accepted` rows, drop proofs NUT-07
 * reports spent, swap the amount out with disjoint send/keep deterministic
 * counter blocks, persist the change as a fresh `accepted` row, and persist
 * the send token as a row in the drafted state. The source rows are removed;
 * funds are never outside the store even when the caller crashes mid-flow.
 */
export class Send extends Effect.Service<Send>()("linkshu/Send", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const tokenStore = yield* TokenStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;

    const send = (draft: SendDraft): Effect.Effect<SendReceipt, SendError> =>
      Effect.gen(function* () {
        const wallet = yield* instances.get(draft.mint, sat);
        const keysetId = yield* boundKeysetId(draft.mint, wallet);
        const scope: CounterScope = { mint: draft.mint, unit: sat, keysetId };

        const { liveRows, spendable, available } = yield* selectSpendableProofs(
          {
            tokenStore,
            inspector,
            wallet,
            mint: draft.mint,
            unit: sat,
            reason: "send",
          },
        );
        if (available < draft.amount) {
          return yield* new InsufficientFunds({
            mint: draft.mint,
            required: draft.amount,
            available: NonNegativeAmount.make(available),
          });
        }

        const swapped = yield* swapProofsForAmount(
          { kv, inspector, wallet, scope },
          { amount: draft.amount, proofs: spendable, available },
        );
        const sendEncoded = encodeCashuProofs({
          mint: draft.mint,
          unit: sat,
          memo: draft.memo ?? null,
          proofs: swapped.send,
        });
        const keepEncoded =
          swapped.keep.length > 0
            ? encodeCashuProofs({
                mint: draft.mint,
                unit: sat,
                memo: null,
                proofs: swapped.keep,
              })
            : null;
        if (
          sendEncoded === null ||
          (swapped.keep.length > 0 && keepEncoded === null)
        ) {
          return yield* malformedSwapProofs(draft.mint);
        }
        const changeAmount = keepEncoded?.amount ?? 0;
        const feePaid = available - sendEncoded.amount - changeAmount;
        if (feePaid < 0) {
          return yield* malformedSwapProofs(draft.mint);
        }

        // Change lands as `accepted` before the sources go away, so the funds
        // are never outside the store even if the caller crashes mid-flow.
        const changeRow =
          keepEncoded === null
            ? null
            : yield* insertRowInState(tokenStore, inspector, {
                originalTokenText: keepEncoded.tokenText,
                tokenText: keepEncoded.tokenText,
                state: "accepted",
                reason: "send-change",
              });
        const sendRow = yield* insertRowInState(tokenStore, inspector, {
          originalTokenText: sendEncoded.tokenText,
          tokenText: sendEncoded.tokenText,
          state: draft.produceAs,
          reason: "send",
        });
        yield* removeConsumedRows(
          tokenStore,
          liveRows,
          changeRow === null ? [sendRow] : [changeRow, sendRow],
        );

        return new SendReceipt({
          rowId: sendRow.id,
          tokenText: sendEncoded.tokenText,
          mint: draft.mint,
          unit: sat,
          amount: sendEncoded.amount,
          changeAmount: NonNegativeAmount.make(changeAmount),
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
