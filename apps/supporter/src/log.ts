import { encodeNpub } from "@linky-fit/linkstr";
import type { Pubkey } from "@linky-fit/linkstr";

export const shortPubkey = (pubkey: Pubkey): string => {
  const npub = encodeNpub(pubkey);
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
};

/**
 * Only the error's tag or class name: messages can quote their input, and
 * logs must never carry token text, keys or award JSON.
 */
export const errorName = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "_tag" in error)
    return String(error._tag);
  return error instanceof Error ? error.name : typeof error;
};

export const logInfo = (line: string): void => {
  console.info(`[supporter] ${line}`);
};

export const logWarn = (line: string, error?: unknown): void => {
  console.warn(
    `[supporter] ${line}${error === undefined ? "" : ` error=${errorName(error)}`}`,
  );
};
