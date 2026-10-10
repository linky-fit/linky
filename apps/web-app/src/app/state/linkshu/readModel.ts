import {
  NonNegativeAmount,
  Tokens,
  WalletBalances,
  type StoredOperation,
  type StoredProof,
  type TokenTransfer,
} from "@linky-fit/linkshu";
import { Cause, Effect } from "effect";
import { walletRepositoryAtom } from "../session/store";
import { linkshuRuntimeAtom } from "./runtime";

export interface LinkshuReadModel {
  readonly balances: WalletBalances;
  readonly proofs: ReadonlyArray<StoredProof>;
  readonly operations: ReadonlyArray<StoredOperation>;
  readonly transfers: ReadonlyArray<TokenTransfer>;
}

export const emptyReadModel: LinkshuReadModel = {
  balances: new WalletBalances({
    total: NonNegativeAmount.make(0),
    spendable: NonNegativeAmount.make(0),
    perMint: [],
  }),
  proofs: [],
  operations: [],
  transfers: [],
};

/** The wallet inventory through linkshu `Tokens`, re-read whenever the wallet repository reports a change. */
export const walletReadModelAtom = linkshuRuntimeAtom.atom((get) =>
  Effect.gen(function* () {
    const wallet = yield* get.result(walletRepositoryAtom);
    // A refresh re-subscribes; inside the store's notify loop the new listener would get the same notification, forever.
    get.addFinalizer(
      wallet.subscribe(() => queueMicrotask(() => get.refreshSelf())),
    );
    const tokens = yield* Tokens;
    return {
      balances: yield* tokens.balances,
      proofs: yield* tokens.proofs,
      operations: yield* tokens.operations,
      transfers: yield* tokens.transfers,
    } satisfies LinkshuReadModel;
  }).pipe(
    Effect.tapCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.sync(() =>
            console.warn("[linky] linkshu wallet read failed", cause),
          ),
    ),
  ),
);
