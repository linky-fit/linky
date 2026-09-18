import {
  decodeNip05Document,
  encodeNpub,
  nip05WellKnownUrl,
  parseNip05Identifier,
  type Nip05Identifier,
} from "@linky/linkstr";

export const DEFAULT_NIP05_DOMAIN = "linky.fit";

type Nip05ResolutionResult =
  | {
      identifier: Nip05Identifier;
      kind: "resolved";
      npub: string;
      relays: string[];
    }
  | { identifier: Nip05Identifier; kind: "not_found" }
  | { identifier: Nip05Identifier; kind: "error"; message: string }
  | { kind: "none" };

export const parseNip05IdentifierInput = (
  value: string,
): Nip05Identifier | null => parseNip05Identifier(value, DEFAULT_NIP05_DOMAIN);

export const getDefaultNip05IdentifierFromAddress = (
  value: string,
): string | null => {
  const identifier = parseNip05Identifier(value);
  if (!identifier || identifier.domain !== DEFAULT_NIP05_DOMAIN) return null;
  return identifier.identifier;
};

const resolveNip05Identifier = async (
  identifier: Nip05Identifier,
  options?: { signal?: AbortSignal },
): Promise<Nip05ResolutionResult> => {
  if (options?.signal?.aborted) return { identifier, kind: "not_found" };

  const url = nip05WellKnownUrl(identifier);

  try {
    const init: RequestInit = {
      headers: { Accept: "application/json" },
      redirect: "manual",
    };
    if (options?.signal) init.signal = options.signal;

    const response = await fetch(url, init);
    if (!response.ok || response.type === "opaqueredirect") {
      return { identifier, kind: "not_found" };
    }

    const body: unknown = await response.json();
    const resolution = decodeNip05Document(body, identifier);
    if (!resolution) return { identifier, kind: "not_found" };

    return {
      identifier,
      kind: "resolved",
      npub: encodeNpub(resolution.pubkey),
      relays: [...resolution.relays],
    };
  } catch (error) {
    if (options?.signal?.aborted) return { identifier, kind: "not_found" };
    return {
      identifier,
      kind: "error",
      message: String(error ?? "unknown"),
    };
  }
};

export const resolveNip05Input = async (
  value: string,
  options?: { signal?: AbortSignal },
): Promise<Nip05ResolutionResult> => {
  const identifier = parseNip05IdentifierInput(value);
  if (!identifier) return { kind: "none" };
  return resolveNip05Identifier(identifier, options);
};

export const resolveVerifiedNip05Identifier = async (
  value: string,
  expectedNpub: string,
  options?: { signal?: AbortSignal },
): Promise<string | null> => {
  const normalizedExpectedNpub = expectedNpub.trim().toLowerCase();
  if (!normalizedExpectedNpub) return null;

  const result = await resolveNip05Input(value, options);
  if (result.kind !== "resolved") return null;
  if (result.npub.toLowerCase() !== normalizedExpectedNpub) return null;

  return result.identifier.identifier;
};
