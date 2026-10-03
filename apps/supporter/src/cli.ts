import { parseMintUrl, runLinkshu, Tokens } from "@linky-fit/linkshu";
import type { Bip39Seed } from "@linky-fit/linkshu";
import { balance, buildCommand } from "@linky-fit/linkshu-cli/commands";
import type { Command } from "@linky-fit/linkshu-cli/commands";
import type { Database } from "bun:sqlite";
import { Effect, Either } from "effect";
import { sqliteLinkshuStores } from "./linkshuStores";

export const CLI_USAGE = `wallet commands, run inside the container:
  balance                 balance per mint, pending operations
  send <amount> [mint]    swap out <amount> sat and print the token
  melt <invoice> [mint]   pay a bolt11 invoice
[mint] defaults to the mint holding the most sat.`;

const CLI_COMMANDS = new Set(["balance", "send", "melt"]);

export const isCliCommand = (name: string | undefined): name is string =>
  name !== undefined && CLI_COMMANDS.has(name);

const richestMint = Effect.flatMap(Tokens, (tokens) => tokens.balances).pipe(
  Effect.map(
    ({ perMint }) =>
      [...perMint].sort((a, b) => b.amount - a.amount)[0]?.mint ?? null,
  ),
);

/** `send` and `melt` from linkshu-cli, on the given mint or the richest one. */
const spendCommand = (
  name: string,
  operand: string | undefined,
  mintArgument: string | undefined,
): Effect.Effect<Command, string, Tokens> =>
  Effect.gen(function* () {
    const mint =
      mintArgument === undefined
        ? yield* richestMint
        : parseMintUrl(mintArgument);
    if (mint === null)
      return yield* Effect.fail(
        mintArgument === undefined
          ? "the wallet holds no sat yet"
          : `not a mint url: ${mintArgument}`,
      );
    return buildCommand(name, operand === undefined ? [] : [operand], mint);
  });

/** Runs one wallet command over the service's SQLite file; returns the exit code. */
export const runCli = async (
  argv: ReadonlyArray<string>,
  bip39Seed: Bip39Seed,
  db: Database,
): Promise<number> => {
  const [name, operand, mintArgument] = argv;
  const command =
    name === "balance"
      ? Effect.succeed(balance)
      : spendCommand(name ?? "", operand, mintArgument);
  const outcome = await runLinkshu(
    { bip39Seed, ...sqliteLinkshuStores(db) },
    Effect.either(
      command.pipe(
        Effect.flatMap((run) =>
          run.pipe(Effect.mapError((failure) => failure._tag)),
        ),
      ),
    ),
  );
  if (Either.isRight(outcome)) return 0;
  console.error(`error: ${outcome.left}`);
  return 1;
};
