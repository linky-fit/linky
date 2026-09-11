import {
  Amount,
  Bolt11Invoice,
  Melt,
  MeltDraft,
  Receive,
  ReceiveDraft,
  Restore,
  RestoreDraft,
  Send,
  SendDraft,
  Tokens,
  Topup,
  TopupDraft,
} from "@linky/linkshu";
import type { LinkshuServices, MintUrl } from "@linky/linkshu";
import { Effect, Schema } from "effect";
import { UsageError } from "./args";

/**
 * Every wallet error the package raises is a `Schema.TaggedError`, so one
 * structural constraint covers the whole dispatch table.
 */
export interface TaggedFailure {
  readonly _tag: string;
}

export type Command = Effect.Effect<void, TaggedFailure, LinkshuServices>;

const print = (line: string): void => {
  console.log(line);
};

const decodeAmount = Schema.decodeUnknownOption(Amount);
const decodeInvoice = Schema.decodeUnknownOption(Bolt11Invoice);

const requireOperand = (
  operands: ReadonlyArray<string>,
  name: string,
): string => {
  const value = operands[0];
  if (value === undefined) throw new UsageError(`missing <${name}>`);
  return value;
};

const requireAmount = (operands: ReadonlyArray<string>): Amount => {
  const raw = requireOperand(operands, "amount");
  const amount = decodeAmount(Number(raw));
  if (amount._tag === "None")
    throw new UsageError(
      `amount must be a positive whole number, got "${raw}"`,
    );
  return amount.value;
};

const requireInvoice = (operands: ReadonlyArray<string>): Bolt11Invoice => {
  const raw = requireOperand(operands, "invoice");
  const invoice = decodeInvoice(raw);
  if (invoice._tag === "None")
    throw new UsageError("invoice must be a bolt11 invoice (starting with ln)");
  return invoice.value;
};

const summarize: Effect.Effect<void, never, LinkshuServices> = Effect.gen(
  function* () {
    const balances = yield* (yield* Tokens).balances;
    print(
      `balance  ${balances.total} sat  (spendable ${balances.spendable} sat)`,
    );
    for (const { mint, amount } of balances.perMint)
      print(`  ${mint}  ${amount} sat`);

    const tokens = yield* Tokens;
    for (const proof of yield* tokens.proofs)
      if (proof.state !== "available" && proof.state !== "spent")
        print(
          `  ${proof.state.padEnd(12)} ${proof.amount} sat  proof ${proof.id}`,
        );
    for (const operation of yield* tokens.operations)
      if (operation.status === "pending" || operation.status === "issued")
        print(
          `  ${operation.kind.padEnd(8)} ${operation.status.padEnd(8)} ${operation.amount} sat  ${operation.id}`,
        );
  },
);

const balance: Command = summarize;

/** No amount means "finish whatever an earlier run left stranded". */
const topup = (mint: MintUrl, operands: ReadonlyArray<string>): Command =>
  operands.length === 0
    ? resumeTopups
    : startTopup(mint, requireAmount(operands));

const startTopup = (mint: MintUrl, amount: Amount): Command =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* (yield* Topup).start(
        new TopupDraft({ mint, amount }),
      );
      print(`quote    ${handle.quote.quoteId}`);
      print(`invoice  ${handle.quote.invoice}`);
      print("waiting for the invoice to be paid…");
      const receipt = yield* handle.result;
      print(`minted   ${receipt.amount} sat`);
    }),
  );

const resumeTopups: Command = Effect.scoped(
  Effect.gen(function* () {
    const handles = yield* (yield* Topup).resumePending();
    if (handles.length === 0) {
      print("no pending topups");
      return;
    }
    for (const handle of handles) {
      print(`resuming ${handle.quote.quoteId} (${handle.quote.amount} sat)`);
      const receipt = yield* handle.result;
      print(`minted   ${receipt.amount} sat`);
    }
  }),
);

const receive = (operands: ReadonlyArray<string>): Command =>
  Effect.gen(function* () {
    const receipt = yield* (yield* Receive).receive(
      new ReceiveDraft({ text: requireOperand(operands, "token") }),
    );
    print(`received ${receipt.amount} ${receipt.unit} from ${receipt.mint}`);
  });

const send = (mint: MintUrl, amount: Amount): Command =>
  Effect.gen(function* () {
    const receipt = yield* (yield* Send).send(
      new SendDraft({ mint, amount, produceAs: "issued" }),
    );
    print(
      `sent     ${receipt.amount} sat  change ${receipt.changeAmount} sat  fee ${receipt.feePaid} sat`,
    );
    print(receipt.tokenText);
  });

/** No invoice means "settle whatever an earlier run left pending". */
const melt = (mint: MintUrl, operands: ReadonlyArray<string>): Command =>
  operands.length === 0
    ? resumeMelts
    : payInvoice(mint, requireInvoice(operands));

const payInvoice = (mint: MintUrl, invoice: Bolt11Invoice): Command =>
  Effect.gen(function* () {
    const draft = new MeltDraft({ mint, invoice });
    const meltService = yield* Melt;
    const quote = yield* meltService.quote(draft);
    print(`quote    ${quote.amount} sat + ${quote.feeReserve} sat reserved`);
    const receipt = yield* meltService.melt(draft);
    print(
      `paid     ${receipt.paidAmount} sat  fee ${receipt.feePaid} sat  change ${receipt.changeAmount} sat`,
    );
  });

const resumeMelts: Command = Effect.gen(function* () {
  const results = yield* (yield* Melt).resumePending;
  if (results.length === 0) {
    print("no pending melts");
    return;
  }
  for (const result of results) {
    const receipt = result.receipt;
    print(
      receipt === null
        ? `${result.status.padEnd(8)} ${result.quoteId} (${result.amount} sat)`
        : `paid     ${receipt.paidAmount} sat  fee ${receipt.feePaid} sat  change ${receipt.changeAmount} sat`,
    );
  }
});

const restore = (mint: MintUrl): Command =>
  Effect.gen(function* () {
    const report = yield* (yield* Restore).restore(
      new RestoreDraft({ mints: [mint] }),
    );
    print(
      `restored ${report.restoredAmount} sat as ${report.restoredProofs} proofs`,
    );
    print(`scanned  ${report.scannedMints.join(", ") || "nothing"}`);
    if (report.unavailableMints.length > 0)
      print(`offline  ${report.unavailableMints.join(", ")}`);
    yield* summarize;
  });

export const buildCommand = (
  name: string,
  operands: ReadonlyArray<string>,
  mint: MintUrl,
): Command => {
  switch (name) {
    case "balance":
      return balance;
    case "topup":
      return topup(mint, operands);
    case "receive":
      return receive(operands);
    case "send":
      return send(mint, requireAmount(operands));
    case "melt":
      return melt(mint, operands);
    case "restore":
      return restore(mint);
    default:
      throw new UsageError(`unknown command "${name}"`);
  }
};
