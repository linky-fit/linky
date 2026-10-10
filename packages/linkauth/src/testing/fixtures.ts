import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { encrypt, getConversationKey } from "nostr-tools/nip44";
import { LINKAUTH_WRAP_KIND, wrapTags } from "../wrap.js";
import type { LinkauthFetch } from "../fetchDomain.js";
import { authTemplate } from "../template.js";
import type { LinkauthAssertion, LinkauthTemplate } from "../types.js";

export const AUDIENCE = "https://shop.example";
export const NONCE = "n".repeat(43);

export const newKey = (): Uint8Array => generateSecretKey();

/** Signs `template` (the canonical login for AUDIENCE and NONCE by default) like a signer would. */
export const signLogin = (
  key: Uint8Array,
  options: { template?: LinkauthTemplate; createdAt?: number } = {},
): LinkauthAssertion =>
  // The round trip drops nostr-tools' cached `verified` marker, as JSON on the wire does.
  JSON.parse(
    JSON.stringify(
      finalizeEvent(
        {
          ...(options.template ??
            authTemplate({ audience: AUDIENCE, nonce: NONCE })),
          created_at: options.createdAt ?? Math.floor(Date.now() / 1000),
        },
        key,
      ),
    ),
  );

export const CALLBACK = `${AUDIENCE}/login/done`;

/** A valid domain document for AUDIENCE, JSON-shaped; override or extend fields per test. */
export const documentFor = (
  pubkey: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  version: 1,
  name: "Shop",
  icon: `${AUDIENCE}/icon.png`,
  pubkey,
  relays: ["wss://relay.shop.example"],
  callbacks: [CALLBACK],
  ...overrides,
});

/** A `fetch` that serves `body` for any URL and records the requests it saw. */
export const fakeFetch = (
  body: string | (() => Response | Promise<Response>),
): {
  fetch: LinkauthFetch;
  requests: { url: string; init: RequestInit }[];
} => {
  const requests: { url: string; init: RequestInit }[] = [];
  return {
    requests,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return typeof body === "string" ? new Response(body) : body();
    },
  };
};

/** A `fetch` that serves the JSON of `document`. */
export const serving = (document: Record<string, unknown>) =>
  fakeFetch(JSON.stringify(document));

/** Like `wrapAssertion`, but dated `createdAt` and optionally with other `tags`. */
export const wrapAt = (
  assertion: LinkauthAssertion,
  domainPubkey: string,
  createdAt: number,
  tags: string[][] | null = wrapTags(assertion, domainPubkey, createdAt),
) => {
  const throwaway = generateSecretKey();
  return finalizeEvent(
    {
      kind: LINKAUTH_WRAP_KIND,
      created_at: createdAt,
      tags: tags ?? [["p", domainPubkey]],
      content: encrypt(
        JSON.stringify(assertion),
        getConversationKey(throwaway, domainPubkey),
      ),
    },
    throwaway,
  );
};
