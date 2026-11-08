import {
  Amount,
  CheckStateEnum,
  getEncodedToken,
  hashToCurve,
} from "@cashu/cashu-ts";
import type { ClaimRow, Database, StoredProof } from "./db";
import type { Minter } from "./minter";
import { describeError, failure, json } from "./responses";

const CLAIMS_PER_RESPONSE = 100;
const utf8 = new TextEncoder();

/** The fork's trimmed form, so old apps see the mint URL they know. */
export const normalizeMintUrl = (value: string): string => {
  const url = new URL(value.trim());
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
};

const proofY = (proof: StoredProof) =>
  hashToCurve(utf8.encode(proof.secret)).toHex(true);

/**
 * Offers the caller's unspent proofs, one token per mint. Rows stay `ready`
 * until the mint reports every proof spent, so a lost response loses nothing.
 */
export async function getClaim(
  db: Database,
  minter: Minter,
  pubkey: string,
): Promise<Response> {
  const rows = await db.readyClaimsOf(pubkey, CLAIMS_PER_RESPONSE);
  const rowsByMint = new Map<string, ClaimRow[]>();
  for (const row of rows) {
    const mintUrl = normalizeMintUrl(row.mint_url);
    rowsByMint.set(mintUrl, [...(rowsByMint.get(mintUrl) ?? []), row]);
  }

  const mints = [...rowsByMint];
  const checks = await Promise.allSettled(
    mints.map(([mintUrl, mintRows]) => checkProofs(minter, mintUrl, mintRows)),
  );

  const tokens: string[] = [];
  let count = 0;
  let failed = false;
  for (const [index, check] of checks.entries()) {
    const mintUrl = mints[index]?.[0] ?? "";
    if (check.status === "rejected") {
      failed = true;
      console.warn(
        `[npubcash-v1] checking proofs at ${mintUrl}: ${describeError(check.reason)}`,
      );
      continue;
    }
    await db.markSpent(check.value.spent);
    const { unspent } = check.value;
    if (unspent.length === 0) continue;
    count += unspent.length;
    tokens.push(
      getEncodedToken({
        mint: mintUrl,
        proofs: unspent.map((proof) => ({
          ...proof,
          amount: Amount.from(proof.amount),
        })),
      }),
    );
  }

  if (count === 0) {
    return failed
      ? failure(502, "Failed to verify claimable proofs")
      : json(200, { error: true, message: "No proofs to claim" });
  }
  return json(200, {
    error: false,
    data: {
      ...(tokens.length === 1 ? { token: tokens[0] } : {}),
      tokens,
      count,
    },
  });
}

async function checkProofs(
  minter: Minter,
  mintUrl: string,
  rows: readonly ClaimRow[],
): Promise<{ unspent: StoredProof[]; spent: ClaimRow[] }> {
  const proofs = rows.flatMap((row) => row.proofs ?? []);
  const { states } = await minter
    .mint(mintUrl)
    .check({ Ys: proofs.map(proofY) });
  const stateByY = new Map(states.map((state) => [state.Y, state.state]));
  const stateOf = (proof: StoredProof) => stateByY.get(proofY(proof));
  return {
    unspent: proofs.filter(
      (proof) => stateOf(proof) === CheckStateEnum.UNSPENT,
    ),
    spent: rows.filter((row) =>
      (row.proofs ?? []).every(
        (proof) => stateOf(proof) === CheckStateEnum.SPENT,
      ),
    ),
  };
}
