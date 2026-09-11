#!/usr/bin/env bun
import { parseMintUrl, runLinkshu } from "@linky/linkshu";
import type { MintUrl } from "@linky/linkshu";
import { Effect, Either } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { UsageError, parseArgs } from "./args";
import { buildCommand } from "./commands";
import type { TaggedFailure } from "./commands";
import { fileKeyValueStore } from "./fileKeyValueStore";
import { fileOperationStore } from "./fileOperationStore";
import { fileProofStore } from "./fileProofStore";
import { loadSeed } from "./seed";
import { stderrInspector } from "./stderrInspector";

const DEFAULT_MINT = "http://localhost:3338";

const USAGE = `linkshu — a cashu wallet on @linky/linkshu

usage: linkshu [options] <command> [arguments]

commands:
  balance             available balance held in the data directory
  topup <amount>      mint quote for <amount> sat, then wait for it to settle
  topup               finish topups an earlier run left pending
  receive <token>     accept a cashu token
  send <amount>       swap out <amount> sat and print the token
  melt <invoice>      pay a bolt11 invoice
  restore             recover the wallet from the seed via NUT-09

options:
  --data-dir <path>   wallet directory (default $LINKSHU_DATA_DIR or ~/.linkshu)
  --mint <url>        mint to operate against (default ${DEFAULT_MINT})
  --verbose           stream linkshu inspector events to stderr
  --help              this text

environment:
  LINKSHU_SEED        64-byte bip39 seed as hex; overrides <data-dir>/seed.hex`;

const resolveDataDir = (fromFlag: string | undefined): string => {
  const dataDir = path.resolve(
    fromFlag ??
      process.env["LINKSHU_DATA_DIR"] ??
      path.join(os.homedir(), ".linkshu"),
  );
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return dataDir;
};

const resolveMint = (fromFlag: string | undefined): MintUrl => {
  const raw = fromFlag ?? process.env["LINKSHU_MINT_URL"] ?? DEFAULT_MINT;
  const mint = parseMintUrl(raw);
  if (mint === null) throw new UsageError(`not a mint url: "${raw}"`);
  return mint;
};

/** The tag leads the line, so the serialized fields drop their copy of it. */
const describe = (failure: TaggedFailure): string => {
  const fields = JSON.stringify(failure, (key: string, value: unknown) =>
    key === "_tag" ? undefined : value,
  );
  return fields === undefined || fields === "{}"
    ? failure._tag
    : `${failure._tag} ${fields}`;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === undefined || args.flags.has("help")) {
    console.log(USAGE);
    return;
  }

  const dataDir = resolveDataDir(args.options["data-dir"]);
  const mint = resolveMint(args.options["mint"]);
  const { seed, source } = loadSeed(dataDir);
  const verbose = args.flags.has("verbose");
  if (verbose)
    console.error(`[linkshu] data ${dataDir}  mint ${mint}  seed ${source}`);

  const outcome = await runLinkshu(
    {
      bip39Seed: seed,
      keyValueStore: fileKeyValueStore(path.join(dataDir, "kv.json")),
      proofStore: fileProofStore(path.join(dataDir, "proofs.json")),
      operationStore: fileOperationStore(path.join(dataDir, "operations.json")),
      ...(verbose ? { inspector: stderrInspector } : {}),
    },
    Effect.either(buildCommand(args.command, args.operands, mint)),
  );

  if (Either.isLeft(outcome)) {
    console.error(`error: ${describe(outcome.left)}`);
    process.exitCode = 1;
  }
};

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`error: ${error.message}\n\n${USAGE}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
