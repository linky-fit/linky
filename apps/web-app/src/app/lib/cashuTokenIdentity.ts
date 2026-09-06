import * as Evolu from "@evolu/common";
import type { CashuTokenId, CashuTokenRow } from "../../evolu";

export const createCashuTokenId = (token: string): CashuTokenId =>
  Evolu.createIdFromString<"CashuToken">(token.trim());

interface CashuTokenIdentityLike {
  rawToken?: unknown;
  token?: unknown;
}

type PersistedCashuTokenIdentity = Pick<
  CashuTokenRow,
  "id" | "rawToken" | "token"
>;

export const readCashuTokenAliases = (
  value:
    | CashuTokenIdentityLike
    | PersistedCashuTokenIdentity
    | null
    | undefined,
): string[] => {
  const aliases = new Set<string>();

  for (const candidate of [value?.rawToken, value?.token]) {
    const normalized = String(candidate ?? "").trim();
    if (!normalized) continue;
    aliases.add(normalized);
  }

  return Array.from(aliases);
};

export const isDeletedCashuRow = (
  row: Pick<CashuTokenRow, "isDeleted">,
): boolean => row.isDeleted === Evolu.sqliteTrue;
