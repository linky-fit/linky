import {
  NonNegativeAmount,
  Tokens,
  WalletBalances,
  type StoredOperation,
  type StoredProof,
  type TokenTransfer,
} from "@linky-fit/linkshu";
import { Cause, Effect } from "effect";
import { changesAtom } from "../session/live";
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

const walletChangesAtom = changesAtom(
  walletRepositoryAtom,
  (wallet) => wallet.subscribe,
);

/** The wallet inventory through linkshu `Tokens`, re-read whenever the wallet repository reports a change. */
export const walletReadModelAtom = linkshuRuntimeAtom.atom((get) =>
  Effect.gen(function* () {
    get(walletChangesAtom);
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
