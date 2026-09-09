import type { Proof as CashuProof } from "@cashu/cashu-ts";
import { Schema } from "effect";
import { Amount } from "../../domain/primitives";
import type { CurrencyUnit, MintUrl, TokenText } from "../../domain/primitives";
import { encodeToken } from "../codec";
import { Proof } from "../domain";
import { decodeTokenFields } from "./v3Json";

export interface EncodedCashuProofs {
  readonly tokenText: TokenText;
  readonly proofs: ReadonlyArray<Proof>;
  readonly amount: Amount;
}

interface EncodeArgs<P> {
  readonly mint: MintUrl;
  readonly unit: CurrencyUnit;
  readonly memo: string | null;
  readonly proofs: ReadonlyArray<P>;
}

const encodeValidated = (
  args: EncodeArgs<unknown>,
): EncodedCashuProofs | null => {
  const decoded = decodeTokenFields(args);
  if (decoded === null) return null;
  const total = decoded.proofs.reduce((sum, proof) => sum + proof.amount, 0);
  return {
    tokenText: encodeToken(decoded),
    proofs: decoded.proofs,
    amount: Amount.make(total),
  };
};

const plainCashuProof = (proof: CashuProof): unknown => ({
  id: proof.id,
  amount: proof.amount.toNumber(),
  secret: proof.secret,
  C: proof.C,
});

/**
 * Encodes proofs returned by a cashu-ts wallet operation as canonical token
 * text plus their total; `null` when the mint handed back malformed proofs.
 */
export const encodeCashuProofs = (
  args: EncodeArgs<CashuProof>,
): EncodedCashuProofs | null =>
  encodeValidated({ ...args, proofs: args.proofs.map(plainCashuProof) });

/** The same, for proofs already in the package's own shape. */
export const encodeProofs = (
  args: EncodeArgs<Proof>,
): EncodedCashuProofs | null => encodeValidated(args);

const decodeProofs = Schema.decodeUnknownOption(Schema.Array(Proof));

/**
 * cashu-ts proofs in the package's own shape; `null` when any of them is
 * malformed — a partial set would silently drop funds.
 */
export const toDomainProofs = (
  proofs: ReadonlyArray<CashuProof>,
): ReadonlyArray<Proof> | null => {
  const decoded = decodeProofs(proofs.map(plainCashuProof));
  return decoded._tag === "Some" ? decoded.value : null;
};
