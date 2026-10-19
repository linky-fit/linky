import type { Pubkey } from "@linky-fit/linkstr";
import { Result } from "effect";
import {
  nip05Url,
  parseContactInput,
  readNip05Document,
  readNip05Response,
  type Nip05Document,
} from "../domain";

const LOOKUP_TIMEOUT_MS = 8_000;

/** A contact the merchant named, with the key it resolved to. */
export interface ResolvedContact {
  readonly pubkey: Pubkey;
  /** The NIP-05 address it was looked up by; `null` for a key given outright. */
  readonly address: string | null;
}

export type ContactFailure =
  /** Not a key, a name or an address. */
  | "invalid"
  /** The domain knows no such name. */
  | "not-found"
  /** The domain did not answer. */
  | "unreachable";

/** Fetches a domain's `nostr.json`; `null` for a reply that is not one. */
export type FetchNip05 = (
  url: string,
  signal: AbortSignal,
) => Promise<Nip05Document | null>;

const fetchNip05: FetchNip05 = async (url, signal) => {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  return response.ok ? readNip05Document(await response.json()) : null;
};

/**
 * Finds the key a typed contact names: an npub or profile link outright,
 * a name or address by its NIP-05 document; `hynek` is `hynek@linky.fit`.
 */
export const resolveContact = async (
  text: string,
  options: {
    readonly fetchNip05?: FetchNip05 | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<Result.Result<ResolvedContact, ContactFailure>> => {
  const input = parseContactInput(text);
  if (input === null) return Result.fail("invalid");
  if (input.kind === "pubkey") {
    return Result.succeed({ pubkey: input.pubkey, address: null });
  }
  const signal =
    options.signal === undefined
      ? AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
      : AbortSignal.any([
          options.signal,
          AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
        ]);
  let body: Nip05Document | null;
  try {
    body = await (options.fetchNip05 ?? fetchNip05)(nip05Url(input), signal);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.warn("[fazole] contact lookup failed", error);
    return Result.fail("unreachable");
  }
  if (body === null) return Result.fail("not-found");
  const pubkey = readNip05Response(body, input.name);
  return pubkey === null
    ? Result.fail("not-found")
    : Result.succeed({ pubkey, address: input.address });
};
