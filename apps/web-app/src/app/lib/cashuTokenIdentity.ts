import { createIdFromString } from "@linky/linksync";
import type { CashuTokenId } from "../../evolu";

/** The id a token text maps to; transaction details reference tokens by it. */
export const createCashuTokenId = (token: string): CashuTokenId =>
  createIdFromString<"CashuToken">(token.trim());
