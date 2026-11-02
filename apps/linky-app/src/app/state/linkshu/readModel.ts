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
      get(walletChangesAtom);
      return yield* (yield* Tokens).proofsOf(operationId);
    }).pipe(warnOnFailure),
  ),
);

/** The spent proofs of the sends the tokens screen lists, which the working set leaves out. */
export const pendingSendsSpentProofsAtom = linkshuRuntimeAtom.atom((get) =>
  Effect.gen(function* () {
    const model = yield* get.result(walletReadModelAtom);
    const tokens = yield* Tokens;
    const linked = yield* Effect.forEach(
      pendingTokenTransfers(model.transfers, model.unspentProofs),
      (send) => tokens.proofsOf(send.id),
    );
    return linked.flat().filter((proof) => proof.state === "spent");
  }).pipe(warnOnFailure),
);
