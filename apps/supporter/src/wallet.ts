import {
  extractTokenText,
  Inspector,
  linkshuServices,
  Receive,
  ReceiveDraft,
  Tokens,
} from "@linky-fit/linkshu";
import type { Bip39Seed, TokenText } from "@linky-fit/linkshu";
import type { Database } from "bun:sqlite";
import { Effect, Either, Layer, ManagedRuntime } from "effect";
import { sqliteLinkshuStores } from "./linkshuStores";
import { logWarn } from "./log";
import { tokenHashOf } from "./pipeline";
import type { ReceiveOutcome, SupporterWallet } from "./pipeline";

export const makeWalletRuntime = (bip39Seed: Bip39Seed, db: Database) =>
  ManagedRuntime.make(
    linkshuServices({ bip39Seed, ...sqliteLinkshuStores(db) }).pipe(
      Layer.provideMerge(Inspector.disabled),
    ),
  );

export type WalletRuntime = ReturnType<typeof makeWalletRuntime>;

const hasFinishedReceive = (text: TokenText) =>
  Effect.flatMap(Tokens, (tokens) => tokens.transfers).pipe(
    Effect.map((transfers) =>
      transfers.some(
        (transfer) =>
          transfer.kind === "receive" &&
          transfer.status === "done" &&
          transfer.tokenText === text,
      ),
    ),
  );

const receive = (raw: string) =>
  Effect.gen(function* () {
    const text = extractTokenText(raw);
    if (text === null) return "invalid";
    const outcome = yield* Effect.either(
      Effect.flatMap(Receive, (service) =>
        service.receive(new ReceiveDraft({ text })),
      ),
    );
    if (Either.isRight(outcome)) return "received";
    const error = outcome.left;
    switch (error._tag) {
      case "ReceiveDeferred":
        return "deferred";
      // Spent or known can be our own receive from before a crash.
      case "TokenAlreadyKnown":
      case "TokenAlreadySpent":
        return (yield* hasFinishedReceive(text)) ? "received" : "spent";
      case "TokenParseFailed":
      case "AmountConsumedByFee":
        return "invalid";
      case "MintUnreachable":
      case "MintRejected":
      case "CounterLockTimeout":
        logWarn("receive will be retried", error);
        return "retry";
    }
  });

const recordedTokenTexts = Effect.flatMap(Tokens, (tokens) =>
  tokens.operations.pipe(
    Effect.map((operations) =>
      operations.flatMap((operation) =>
        (operation.kind === "receive" ||
          operation.kind === "deferredReceive") &&
        operation.tokenText !== null
          ? [{ id: operation.id, text: operation.tokenText }]
          : [],
      ),
    ),
  ),
);

const resumeDeferred = Effect.gen(function* () {
  const results = yield* Effect.flatMap(
    Receive,
    (service) => service.resumeDeferred,
  );
  const pending = new Set(
    results
      .filter((result) => result.status === "pending")
      .map((result) => result.operationId),
  );
  const recorded = yield* recordedTokenTexts;
  return new Set(
    recorded
      .filter((operation) => pending.has(operation.id))
      .map((operation) => tokenHashOf(operation.text)),
  );
});

export const createLinkshuWallet = (
  runtime: WalletRuntime,
): SupporterWallet => ({
  receive: (raw): Promise<ReceiveOutcome> => runtime.runPromise(receive(raw)),
  resumeDeferred: () => runtime.runPromise(resumeDeferred),
  findTokenText: (tokenHash) =>
    runtime.runPromise(
      Effect.map(
        recordedTokenTexts,
        (recorded) =>
          recorded.find(
            (operation) => tokenHashOf(operation.text) === tokenHash,
          )?.text ?? null,
      ),
    ),
});
