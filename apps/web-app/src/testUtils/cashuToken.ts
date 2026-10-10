export interface CashuTokenOptions {
  amounts?: readonly number[];
  /** A pubkey to P2PK-lock (NUT-11) every proof to. */
  lockedTo?: string;
  memo?: string;
  mint?: string;
  unit?: string;
}

/** A syntactically valid `cashuA…` token with fake proofs for the given amounts. */
export const buildCashuToken = ({
  amounts = [21],
  lockedTo,
  memo,
  mint = "https://mint.example",
  unit,
}: CashuTokenOptions = {}): string => {
  const proofs = amounts.map((amount, index) => ({
    amount,
    C: `c-${index}`,
    id: "keyset",
    secret:
      lockedTo === undefined
        ? `secret-${index}`
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
