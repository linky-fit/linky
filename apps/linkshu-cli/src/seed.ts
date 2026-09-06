import { Bip39Seed } from "@linky/linkshu";
import * as fs from "node:fs";
import * as path from "node:path";

const SEED_BYTES = 64;

export interface LoadedSeed {
  readonly seed: Bip39Seed;
  /** Where it came from, for the `--verbose` banner. */
  readonly source: string;
}

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

const fromHex = (value: string, origin: string): Bip39Seed => {
  const hex = value.trim().toLowerCase();
  if (!new RegExp(`^[0-9a-f]{${SEED_BYTES * 2}}$`).test(hex))
    throw new Error(
      `${origin} must hold ${SEED_BYTES * 2} hex characters (a ${SEED_BYTES}-byte bip39 seed)`,
    );
  return Bip39Seed.make(new Uint8Array(Buffer.from(hex, "hex")));
};

/**
 * `LINKSHU_SEED` wins, then `<dataDir>/seed.hex`, then a fresh seed written
 * with owner-only permissions. Restoring a wiped data directory means passing
 * the old seed back in through the environment.
 */
export const loadSeed = (dataDir: string): LoadedSeed => {
  const fromEnvironment = process.env["LINKSHU_SEED"];
  if (fromEnvironment !== undefined && fromEnvironment.trim().length > 0)
    return {
      seed: fromHex(fromEnvironment, "LINKSHU_SEED"),
      source: "LINKSHU_SEED",
    };

  const seedPath = path.join(dataDir, "seed.hex");
  if (fs.existsSync(seedPath))
    return {
      seed: fromHex(fs.readFileSync(seedPath, "utf8"), seedPath),
      source: seedPath,
    };

  const generated = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  try {
    // `wx`: if a concurrent first run won the race, its seed is the wallet's.
    fs.writeFileSync(seedPath, `${toHex(generated)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    const lost =
      error instanceof Error && "code" in error && error.code === "EEXIST";
    if (!lost) throw error;
    return {
      seed: fromHex(fs.readFileSync(seedPath, "utf8"), seedPath),
      source: seedPath,
    };
  }
  return { seed: Bip39Seed.make(generated), source: `${seedPath} (generated)` };
};
