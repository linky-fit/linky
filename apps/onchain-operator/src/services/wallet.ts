import {
  Amount,
  Melt,
  MeltDraft,
  OperationId,
  P2pkUnlockingKey,
  Receive,
  ReceiveDraft,
  Send,
  SendDraft,
  Tokens,
  Validation,
} from "@linky-fit/linkshu";
import type {
  Bolt11Invoice,
  LinkshuServices,
  MeltCost,
  MeltError,
  MeltReceipt,
  MeltResumeResult,
  MintUrl,
  ReceiveError,
  ReceiveReceipt,
  SendError,
  SendReceipt,
  TokenTransfer,
  WalletBalances,
} from "@linky-fit/linkshu";
import type { NostrSecretKey } from "@linky-fit/linkstr";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Effect, Result } from "effect";
import type { LinkshuRuntime } from "./runtimes";

/** The account's cashu wallet. */
export interface Wallet {
  /** Receives a token or NUT-18 payload, such as one in a message. */
  readonly receive: (
    text: string,
  ) => Promise<Result.Result<ReceiveReceipt, ReceiveError>>;
  /**
   * A pending send of `amount` at the mint for a message to carry; with
   * `forRequest` it adds the fee the recipient pays to redeem it, as NUT-18 asks.
   */
  readonly send: (
    mint: MintUrl,
    amount: number,
    forRequest: boolean,
  ) => Promise<Result.Result<SendReceipt, SendError>>;
  /** Closes a send whose token reached its recipient. */
  readonly forgetSend: (operationId: string) => Promise<void>;
  readonly balances: () => Promise<WalletBalances>;
  /** A token of `amount` at the mint for the operator to hand over; listed in `issuedTokens` until claimed or taken back. */
  readonly issueToken: (
    mint: MintUrl,
    amount: number,
  ) => Promise<Result.Result<SendReceipt, SendError>>;
  /** Issued tokens not known to be claimed, newest first; reads the store only. */
  readonly issuedTokens: () => Promise<readonly TokenTransfer[]>;
  /** Asks the mints which issued tokens were claimed and closes those. */
  readonly checkClaims: () => Promise<void>;
  /** Takes a send's token back into the balance, making any copy handed out worthless. */
  readonly takeBack: (operationId: OperationId) => Promise<TakeBackOutcome>;
  /** Prices paying `invoice` from the mint; touches no proof. */
  readonly priceMelt: (
    mint: MintUrl,
    invoice: Bolt11Invoice,
  ) => Promise<Result.Result<MeltCost, MeltError>>;
  /** Pays a priced invoice, never taking more than `cost.maxTotal`. */
  readonly melt: (
    cost: MeltCost,
    invoice: Bolt11Invoice,
  ) => Promise<Result.Result<MeltReceipt, MeltError>>;
  /** Settles melts a reload or a lost mint answer left pending. */
  readonly resumeMelts: () => Promise<readonly MeltResumeResult[]>;
}

/** `claimed`: the recipient redeemed the token first, so nothing came back. */
export type TakeBackOutcome =
  | "returned"
  | "claimed"
  | "mintUnreachable"
  | "failed";

/** Failures worth replaying the message for: the token may still be received later. */
export const isTransientReceiveError = (error: ReceiveError): boolean =>
  error._tag === "MintUnreachable" ||
  error._tag === "ReceiveDeferred" ||
  error._tag === "CounterLockTimeout";

export const createWallet = (
  runtime: LinkshuRuntime,
  secretKey: NostrSecretKey,
): Wallet => {
  const run = <A, E>(effect: Effect.Effect<A, E, LinkshuServices>) =>
    runtime.runPromise(Effect.result(effect));
  const unlockingKey = P2pkUnlockingKey.make(bytesToHex(secretKey));
  return {
    receive: (text) =>
      run(
        Effect.flatMap(Receive, (receive) =>
          receive.receive(new ReceiveDraft({ text, automatic: true }), {
            unlockingKey,
          }),
        ),
      ),
    send: (mint, amount, forRequest) =>
      run(
        Effect.flatMap(Send, (send) =>
          send.send(
            new SendDraft({
              mint,
              amount: Amount.make(amount),
              produceAs: "pending",
              ...(forRequest ? { includeRecipientFee: true } : {}),
            }),
          ),
        ),
      ),
    forgetSend: async (operationId) => {
      await run(
        Effect.flatMap(Tokens, (tokens) =>
          tokens.forget(OperationId.make(operationId)),
        ),
      );
    },
    balances: () =>
      runtime.runPromise(Effect.flatMap(Tokens, (tokens) => tokens.balances)),
    issueToken: (mint, amount) =>
      run(
        Effect.flatMap(Send, (send) =>
          send.send(
            new SendDraft({
              mint,
              amount: Amount.make(amount),
              produceAs: "issued",
            }),
          ),
        ),
      ),
    issuedTokens: async () =>
      (
        await runtime.runPromise(
          Effect.flatMap(Tokens, (tokens) => tokens.transfers),
        )
      )
        .filter(
          (transfer) =>
            transfer.kind === "send" && transfer.status === "issued",
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    checkClaims: async () => {
      await run(
        Effect.flatMap(Validation, (validation) => validation.checkIssued),
      );
    },
    takeBack: async (operationId) => {
      const returned = await run(
        Effect.flatMap(Tokens, (tokens) => tokens.returnToWallet(operationId)),
      );
      if (Result.isSuccess(returned)) return "returned";
      switch (returned.failure._tag) {
        case "TokenAlreadySpent":
          return "claimed";
        case "MintUnreachable":
        case "CounterLockTimeout":
          return "mintUnreachable";
        default:
          console.warn(
            "[onchain-operator] token not taken back",
            returned.failure._tag,
          );
          return "failed";
      }
    },
    priceMelt: (mint, invoice) =>
      run(
        Effect.flatMap(Melt, (melt) =>
          Effect.flatMap(
            melt.quote(new MeltDraft({ mint, invoice })),
            melt.cost,
          ),
        ),
      ),
    melt: (cost, invoice) =>
      run(
        Effect.flatMap(Melt, (melt) =>
          melt.melt(
            new MeltDraft({
              mint: cost.quote.mint,
              invoice,
              quoteId: cost.quote.quoteId,
              maxTotal: cost.maxTotal,
            }),
          ),
        ),
      ),
    resumeMelts: () =>
      runtime.runPromise(Effect.flatMap(Melt, (melt) => melt.resumePending)),
  };
};
