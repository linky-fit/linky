import * as Evolu from "@evolu/common";
import type { CashuTokenId } from "../../evolu";

/** The id a token text maps to; transaction details reference tokens by it. */
export const createCashuTokenId = (token: string): CashuTokenId =>
  Evolu.createIdFromString<"CashuToken">(token.trim());
