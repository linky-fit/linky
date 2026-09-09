import { Amount, getEncodedToken } from "@cashu/cashu-ts";
import {
  CurrencyUnit,
  MintUrl,
  TokenRowId,
  TokenText,
  UnixSeconds,
} from "../domain/primitives";
import { StoredTokenRow } from "../ports/TokenStore";
import type { TokenState } from "../token/domain";
import {
  collectAcceptedSources,
  dedupeSourceProofs,
  partitionByProofState,
} from "./spend";

const mint = MintUrl.make("https://mint.example");
const otherMint = MintUrl.make("https://other.example");
const sat = CurrencyUnit.make("sat");
const keysetHex = "009a1f293253e41e";

const token = (mintUrl: string, entries: Array<[number, string]>): string =>
  getEncodedToken({
    mint: mintUrl,
    unit: "sat",
    proofs: entries.map(([amount, secret]) => ({
      id: keysetHex,
      amount: Amount.from(amount),
      secret,
      C: "02" + "ab".repeat(32),
    })),
  });

let nextId = 0;
const row = (tokenText: string, state: TokenState = "accepted") =>
  new StoredTokenRow({
    id: TokenRowId.make(`row-${++nextId}`),
    originalTokenText: TokenText.make(tokenText),
    tokenText: TokenText.make(tokenText),
    state,
    error: null,
    createdAt: UnixSeconds.make(1),
  });

describe("collectAcceptedSources", () => {
  it("keeps only accepted rows decodable at the target mint and unit", () => {
    const good = row(token(mint, [[4, "a1"]]));
    const foreign = row(token(otherMint, [[8, "f1"]]));
    const pending = row(token(mint, [[2, "p1"]]), "pending");
    const issued = row(token(mint, [[2, "i1"]]), "issued");

    const sources = collectAcceptedSources(
      [good, foreign, pending, issued],
      mint,
      sat,
      [],
    );
    expect(sources.map((source) => source.row.id)).toEqual([good.id]);
    expect(sources[0]?.proofs.map((proof) => proof.secret)).toEqual(["a1"]);
  });
});

describe("dedupeSourceProofs", () => {
  it("returns each secret once across rows", () => {
    const shared = token(mint, [
      [4, "a1"],
      [2, "a2"],
    ]);
    const sources = collectAcceptedSources(
      [row(shared), row(shared)],
      mint,
      sat,
      [],
    );
    expect(dedupeSourceProofs(sources).map((proof) => proof.secret)).toEqual([
      "a1",
      "a2",
    ]);
  });
});

describe("partitionByProofState", () => {
  it("splits fully spent rows from live ones and sums the unspent pool", () => {
    const partial = row(
      token(mint, [
        [4, "a1"],
        [2, "a2"],
      ]),
    );
    const dead = row(token(mint, [[3, "z1"]]));
    const sources = collectAcceptedSources([partial, dead], mint, sat, []);

    const partition = partitionByProofState(
      sources,
      new Set(["a2", "z1"]),
      new Set(["a1"]),
    );
    expect(partition.fullySpentRows.map((r) => r.id)).toEqual([dead.id]);
    expect(partition.liveRows.map((r) => r.id)).toEqual([partial.id]);
    expect(partition.spendable.map((proof) => proof.secret)).toEqual(["a1"]);
    expect(partition.available).toBe(4);
  });

  it("keeps twin rows live while offering their shared proofs once", () => {
    const shared = token(mint, [[4, "a1"]]);
    const sources = collectAcceptedSources(
      [row(shared), row(shared)],
      mint,
      sat,
      [],
    );

    const partition = partitionByProofState(
      sources,
      new Set(),
      new Set(["a1"]),
    );
    expect(partition.liveRows).toHaveLength(2);
    expect(partition.spendable).toHaveLength(1);
    expect(partition.available).toBe(4);
  });
});
