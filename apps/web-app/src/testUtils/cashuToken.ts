export interface CashuTokenOptions {
  amounts?: readonly number[];
  memo?: string;
  mint?: string;
  unit?: string;
}

/** A syntactically valid `cashuA…` token with fake proofs for the given amounts. */
export const buildCashuToken = ({
  amounts = [21],
  memo,
  mint = "https://mint.example",
  unit,
}: CashuTokenOptions = {}): string => {
  const proofs = amounts.map((amount, index) => ({
    amount,
    C: `c-${index}`,
    id: "keyset",
    secret: `secret-${index}`,
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
