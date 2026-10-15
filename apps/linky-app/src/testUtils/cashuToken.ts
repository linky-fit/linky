import { decodeTokenText, encodeToken } from "@linky-fit/linkshu";

export interface CashuTokenOptions {
  amounts?: readonly number[];
  /** A pubkey to P2PK-lock (NUT-11) every proof to. */
  lockedTo?: string;
  memo?: string;
  mint?: string;
  /** Prefix of the proof secrets, which name the token's proofs. */
  secretPrefix?: string;
  unit?: string;
}

/** A decodable `cashuA…` token with fake proofs for the given amounts. */
export const buildCashuToken = ({
  amounts = [21],
  lockedTo,
  memo,
  mint = "https://mint.example",
  secretPrefix = "secret",
  unit,
}: CashuTokenOptions = {}): string => {
  const proofs = amounts.map((amount, index) => ({
    amount,
    C: `02${index.toString(16).padStart(64, "0")}`,
    id: "009a1f293253e41e",
    secret:
      lockedTo === undefined
        ? `${secretPrefix}-${index}`
        : JSON.stringify([
            "P2PK",
            { nonce: `${index}`.padStart(64, "0"), data: lockedTo, tags: [] },
          ]),
  }));
  const payload = JSON.stringify({
    token: [{ mint, proofs }],
    ...(unit === undefined ? {} : { unit }),
    ...(memo === undefined ? {} : { memo }),
  });
  return `cashuA${btoa(payload)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;
};

/** A token's proofs as v4 text and as the NUT-18 payment payload a payer sends. */
export const reencodeCashuToken = (token: string) => {
  const decoded = decodeTokenText(token);
  if (decoded === null) throw new Error("Test token does not decode");
  return {
    v4: encodeToken(decoded),
    payload: JSON.stringify({
      id: "request-1",
      mint: decoded.mint,
      unit: decoded.unit,
      proofs: decoded.proofs,
    }),
  };
};
