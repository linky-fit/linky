import {
  NonNegativeAmount,
  Tokens,
  WalletBalances,
  type OperationId,
  type StoredOperation,
  type StoredProof,
  type TokenTransfer,
} from "@linky-fit/linkshu";
import { Cause, Effect } from "effect";
import { Atom } from "effect/reactivity";
import { pendingTokenTransfers } from "../../lib/pendingTokenTransfers";
import { changesAtom } from "../session/live";
import { walletRepositoryAtom } from "../session/store";
import { linkshuRuntimeAtom } from "./runtime";

export interface LinkshuReadModel {
  readonly balances: WalletBalances;
  /** The working set: every proof not yet spent. */
  readonly unspentProofs: ReadonlyArray<StoredProof>;
  readonly operations: ReadonlyArray<StoredOperation>;
  readonly transfers: ReadonlyArray<TokenTransfer>;
}

export const emptyReadModel: LinkshuReadModel = {
  balances: new WalletBalances({
    total: NonNegativeAmount.make(0),
    spendable: NonNegativeAmount.make(0),
    perMint: [],
  }),
  unspentProofs: [],
  operations: [],
  transfers: [],
};

const walletChangesAtom = changesAtom(
  walletRepositoryAtom,
  (wallet) => wallet.subscribe,
);

/** Spent-only changes too, which the unspent subscription above misses. */
const operationChangesAtom = Atom.family((operationId: OperationId) =>
  changesAtom(
    walletRepositoryAtom,
    (wallet) => (listener) =>
      wallet.subscribeOperations([operationId], listener),
  ),
);

const warnOnFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.sync(() =>
            console.warn("[linky] linkshu wallet read failed", cause),
          ),
    ),
  );

/** The wallet inventory through linkshu `Tokens`, re-read whenever the wallet repository reports a change. */
export const walletReadModelAtom = linkshuRuntimeAtom.atom((get) =>
  Effect.gen(function* () {
    get(walletChangesAtom);
    const tokens = yield* Tokens;
    return {
      balances: yield* tokens.balances,
      unspentProofs: yield* tokens.unspentProofs,
      operations: yield* tokens.operations,
      transfers: yield* tokens.transfers,
    } satisfies LinkshuReadModel;
  }).pipe(warnOnFailure),
);

/** One operation's proofs, spent ones included, for the screen showing it. */
export const operationProofsAtom = Atom.family((operationId: OperationId) =>
  linkshuRuntimeAtom.atom((get) =>
    Effect.gen(function* () {
      get(operationChangesAtom(operationId));
      return yield* (yield* Tokens).proofsOf(operationId);
    }).pipe(warnOnFailure),
  ),
);

/** The spent proofs of the sends the tokens screen lists, which the working set leaves out. */
export const pendingSendsSpentProofsAtom = linkshuRuntimeAtom.atom((get) =>
  Effect.gen(function* () {
    const model = yield* get.result(walletReadModelAtom);
    const tokens = yield* Tokens;
    const sends = pendingTokenTransfers(model.transfers, model.unspentProofs);
    for (const send of sends) get(operationChangesAtom(send.id));
    const linked = yield* Effect.forEach(sends, (send) =>
      tokens.proofsOf(send.id),
    );
    return linked.flat().filter((proof) => proof.state === "spent");
  }).pipe(warnOnFailure),
);
