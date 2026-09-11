import { LegacyTokenRow, TokenText, UnixSeconds } from "@linky/linkshu";
import { Schema } from "effect";
import type { CashuTokenRow } from "../../evolu";
import { isDeletedCashuRow } from "./cashuTokenIdentity";
import {
  CASHU_TOKEN_STATE_ACCEPTED,
  CASHU_TOKEN_STATE_ERROR,
  normalizeCashuTokenState,
} from "./cashuTokenState";

/**
 * Catch-all tagged shape for pre-linkshu plain-text `error` values; rows
 * written by linkshu carry serialized tagged errors and pass through.
 */
class LegacyError extends Schema.TaggedError<LegacyError>()("LegacyError", {
  detail: Schema.String,
}) {}

const encodeLegacyError = Schema.encodeSync(Schema.parseJson(LegacyError));
const decodeTokenText = Schema.decodeUnknownOption(TokenText);

const parseTokenText = (value: string | null): TokenText | null => {
  if (value === null) return null;
  const decoded = decodeTokenText(value.trim());
  return decoded._tag === "Some" ? decoded.value : null;
};

const isSerializedTaggedError = (text: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof Reflect.get(parsed, "_tag") === "string"
    );
  } catch {
    return false;
  }
};

const toPortableErrorText = (error: string | null): string | null => {
  const text = (error ?? "").trim();
  if (!text) return null;
  if (isSerializedTaggedError(text)) return text;
  return encodeLegacyError(new LegacyError({ detail: text }));
};

/**
 * A legacy `cashuToken` row as linkshu's ingest reads it: deleted rows and
 * rows whose text is not a cashu token yield nothing. Null and unknown
 * states read as `accepted`, matching what the pre-inventory adapter did.
 */
export const toLegacyTokenRow = (row: CashuTokenRow): LegacyTokenRow | null => {
  if (isDeletedCashuRow(row)) return null;
  const tokenText = parseTokenText(row.token);
  if (tokenText === null) return null;
  const state =
    normalizeCashuTokenState(row.state) ?? CASHU_TOKEN_STATE_ACCEPTED;
  return new LegacyTokenRow({
    id: row.id,
    originalTokenText:
      parseTokenText(row.originalTokenText) ??
      parseTokenText(row.rawToken) ??
      tokenText,
    tokenText,
    state,
    error:
      state === CASHU_TOKEN_STATE_ERROR ? toPortableErrorText(row.error) : null,
    createdAt: UnixSeconds.make(
      Math.max(1, Math.floor(Date.parse(row.createdAt) / 1000)),
    ),
  });
};
