import { Effect } from "effect";
import { TokenText } from "../domain/primitives";
import { NewTokenRow, TokenStore } from "../ports/TokenStore";
import type { StoredTokenRow } from "../ports/TokenStore";
import { parseTokenText } from "../token/codec";
import type { TokenState } from "../token/domain";

/** Inserts `tokenText` as its own original encoding, in `state`. */
export const seedRow = (
  tokenText: string,
  state: TokenState = "accepted",
  error: string | null = null,
) =>
  Effect.flatMap(TokenStore, (store) =>
    store.insert(
      new NewTokenRow({
        originalTokenText: TokenText.make(tokenText),
        tokenText: TokenText.make(tokenText),
        state,
        error,
      }),
    ),
  );

export const amountOf = (
  row: StoredTokenRow | undefined,
): number | undefined =>
  row === undefined ? undefined : parseTokenText(row.tokenText)?.amount;
