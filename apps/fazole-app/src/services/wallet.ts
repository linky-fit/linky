import {
  Autoswap,
  AutoswapDraft,
  Mints,
  OperationId,
  P2pkUnlockingKey,
  ProofStore,
  QuoteLockingKey,
  Receive,
  ReceiveDraft,
  Tokens,
} from "@linky-fit/linkshu";
import type {
  LinkshuServices,
  MintUrl,
  ReceiveError,
  ReceiveReceipt,
  TokenTransfer,
  WalletBalances,
} from "@linky-fit/linkshu";
import type { NostrSecretKey } from "@linky-fit/linkstr";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect, Result } from "effect";
import type { LinkshuRuntime } from "./runtimes";

/** The account's cashu wallet. */
export interface Wallet {
  readonly runtime: LinkshuRuntime;
  /** Runs a wallet effect; typed failures come back as a failed `Result`, defects reject. */
  readonly run: <A, E>(
    effect: Effect.Effect<A, E, LinkshuServices>,
  ) => Promise<Result.Result<A, E>>;
  /** NUT-20: mint quotes are locked to the account's Nostr key. */
  readonly lockingKey: QuoteLockingKey;
  /** Receives a token or NUT-18 payload nobody asked for, such as one in a message. */
  readonly receive: (
    text: string,
  ) => Promise<Result.Result<ReceiveReceipt, ReceiveError>>;
  /** Moves the sats at `from` to `to` over Lightning; the fee it cost, `null` when nothing moved. */
  readonly moveAll: (from: MintUrl, to: MintUrl) => Promise<number | null>;
  /** Finishes moves an earlier session left halfway. */
  readonly resumeMoves: () => Promise<void>;
  /** Whether `operationId` is a receive that finished, so its sats are in the wallet. */
  readonly isReceived: (operationId: string) => Promise<boolean>;
  /** Takes an undelivered send's token back into the balance; `false` when it has to be tried again. */
  readonly returnSend: (operationId: string) => Promise<boolean>;
  /** Closes a send whose token reached its recipient. */
  readonly forgetSend: (operationId: string) => Promise<void>;
  /** Sends whose token has not been confirmed delivered or taken back. */
  readonly pendingSends: () => Promise<readonly TokenTransfer[]>;
  readonly balances: () => Promise<WalletBalances>;
  /** The mint holding the most sats, which withdrawals spend from. */
  readonly richestMint: () => Promise<{
    readonly mint: MintUrl;
    readonly sats: number;
  } | null>;
  /** The mint's input fee per thousand proofs (NUT-02); `null` when it cannot be read. */
  readonly inputFeePpk: (mint: MintUrl) => Promise<number | null>;
  /** How many proofs make up the mint's balance, which sets the fee of spending all of it. */
  readonly availableProofCount: (mint: MintUrl) => Promise<number>;
}

/** Failures worth replaying the message for: the token may still be received later. */
export const isTransientReceiveError = (error: ReceiveError): boolean =>
  error._tag === "MintUnreachable" ||
  error._tag === "ReceiveDeferred" ||
  error._tag === "CounterLockTimeout";

export const createWallet = (
  runtime: LinkshuRuntime,
  secretKey: NostrSecretKey,
): Wallet => {
  const run: Wallet["run"] = (effect) =>
    runtime.runPromise(Effect.result(effect));
  const keyHex = bytesToHex(secretKey);
  const unlockingKey = P2pkUnlockingKey.make(keyHex);
  const transfers = () =>
    runtime.runPromise(Effect.flatMap(Tokens, (tokens) => tokens.transfers));
  const balances = () =>
    runtime.runPromise(Effect.flatMap(Tokens, (tokens) => tokens.balances));
  return {
    runtime,
    run,
    lockingKey: QuoteLockingKey.make(keyHex),
    receive: (text) =>
      run(
        Effect.flatMap(Receive, (receive) =>
          receive.receive(new ReceiveDraft({ text, automatic: true }), {
            unlockingKey,
          }),
        ),
      ),
    moveAll: async (from, to) => {
      const moved = await run(
        Effect.flatMap(Autoswap, (autoswap) =>
          autoswap.claim(
            new AutoswapDraft({ sourceMint: from, targetMint: to }),
          ),
        ),
      );
      if (Result.isSuccess(moved)) return moved.success.feePaid;
      console.warn("[fazole] sats not moved", moved.failure._tag);
      return null;
    },
    resumeMoves: async () => {
      await run(
        Effect.flatMap(Autoswap, (autoswap) => autoswap.resumePendingClaims),
      );
    },
    isReceived: async (operationId) =>
      (await transfers()).some(
        (transfer) =>
          transfer.id === operationId &&
          transfer.kind === "receive" &&
          transfer.status === "done",
      ),
    returnSend: async (operationId) => {
      const returned = await run(
        Effect.flatMap(Tokens, (tokens) =>
          tokens.returnToWallet(OperationId.make(operationId)),
        ),
      );
      if (Result.isFailure(returned)) {
        console.warn("[fazole] send not returned", returned.failure._tag);
      }
      return Result.isSuccess(returned);
    },
    forgetSend: async (operationId) => {
      await run(
        Effect.flatMap(Tokens, (tokens) =>
          tokens.forget(OperationId.make(operationId)),
        ),
      );
    },
    pendingSends: async () =>
      (await transfers()).filter(
        (transfer) => transfer.kind === "send" && transfer.status === "pending",
      ),
    balances,
    richestMint: async () => {
      const [richest] = [...(await balances()).perMint].sort(
        (a, b) => b.amount - a.amount,
      );
      return richest && richest.amount > 0
        ? { mint: richest.mint, sats: richest.amount }
        : null;
    },
    inputFeePpk: async (mint) => {
      const info = await run(
        Effect.flatMap(Mints, (mints) => mints.info(mint)),
      );
      return Result.isSuccess(info) ? info.success.inputFeePpk : null;
    },
    availableProofCount: async (mint) =>
      (
        await runtime.runPromise(
          Effect.flatMap(ProofStore, (store) => store.loadAll),
        )
      ).filter(
        (proof) =>
          proof.mint === mint &&
          proof.unit === "sat" &&
          proof.state === "available",
      ).length,
  };
};
