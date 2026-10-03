import {
  Amount,
  CurrencyUnit,
  DecodedToken,
  encodeToken,
  KeysetId,
  MintUrl,
  Proof,
} from "@linky-fit/linkshu";
import { derivePubkey, NostrSecretKey, RumorId } from "@linky-fit/linkstr";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const TEST_MINT = MintUrl.make("https://mint.example");

export const tokenText = (
  amount: number,
  options: { mint?: string; unit?: string; secret?: string } = {},
): string =>
  encodeToken(
    new DecodedToken({
      mint: MintUrl.make(options.mint ?? TEST_MINT),
      unit: CurrencyUnit.make(options.unit ?? "sat"),
      memo: null,
      proofs: [
        new Proof({
          id: KeysetId.make("009a1f293253e41e"),
          amount: Amount.make(amount),
          secret: options.secret ?? `secret-${amount}`,
          C: "02" + "cd".repeat(32),
        }),
      ],
    }),
  );

export const testPubkey = (fill: number) =>
  derivePubkey(NostrSecretKey.make(new Uint8Array(32).fill(fill)));

export const testRumorId = (fill: string) => RumorId.make(fill.repeat(64));

export const withTempDir = async <A>(
  run: (directory: string) => A | Promise<A>,
): Promise<A> => {
  const directory = mkdtempSync(join(tmpdir(), "linky-supporter-"));
  try {
    return await run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
