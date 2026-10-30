import { PrivateDirectMessage } from "nostr-tools/kinds";
import { decode } from "nostr-tools/nip19";
import { createRumor, createSeal, createWrap } from "nostr-tools/nip59";
import {
  SimplePool,
  useWebSocketImplementation as setWebSocketImplementation,
} from "nostr-tools/pool";
import { generateSecretKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/pure";
import WebSocket from "ws";
import {
  contactMessageSubject,
  formatContactMessage,
  parseContactMessage,
} from "../src/contactMessage.js";

/**
 * The site's contact form: the message goes to the configured npubs as one
 * NIP-17 chat message, from a key made for that one message, the way
 * Payky's form delivers. The server holds no key and keeps nothing; a relay
 * that accepted a copy for a recipient is the only trace.
 */

// Node's own WebSocket closes a failed connection by firing its error again,
// which nostr-tools answers with another close, without end; `ws` does not.
setWebSocketImplementation(WebSocket);

const RELAY_MAX_WAIT_MS = 6_000;

const defaultRecipients = [
  "npub1wfxgaznkc7xz9t7zk6mwrn665twz6ghqdgmx0l3lumus2hhjs0yquvld92",
];

const defaultRelays = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.0xchat.com",
  "wss://nostr.linky.fit",
];

/** A comma-separated env value as a list; `fallback` when unset or empty. */
const list = (
  value: string | undefined,
  fallback: readonly string[],
): readonly string[] => {
  const items = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return items.length === 0 ? fallback : items;
};

export const npubToHex = (npub: string): string | null => {
  try {
    const decoded = decode(npub);
    return decoded.type === "npub" ? decoded.data : null;
  } catch {
    return null;
  }
};

export type PublishResults = readonly PromiseSettledResult<string>[];

/** Sends `event` to `relays`, settling per relay as nostr-tools' pool does. */
export type Publish = (
  relays: readonly string[],
  event: Event,
) => Promise<PublishResults>;

const publishToRelays: Publish = async (relays, event) => {
  const pool = new SimplePool();
  try {
    return await Promise.allSettled(
      pool.publish([...relays], event, { maxWait: RELAY_MAX_WAIT_MS }),
    );
  } finally {
    pool.destroy();
  }
};

const headers = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

type Body =
  | { readonly status: "OK" }
  | { readonly status: "ERROR"; readonly reason: string };

const json = (body: Body, status = 200): Response =>
  Response.json(body, { status, headers });

const preflight = (): Response =>
  new Response(null, {
    headers: {
      ...headers,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });

export const handleContactRequest = async (
  request: Request,
  {
    recipients = list(process.env.FAZOLE_CONTACT_NPUBS, defaultRecipients),
    relays = list(process.env.FAZOLE_CONTACT_RELAYS, defaultRelays),
    publish = publishToRelays,
    now = () => Date.now(),
  }: {
    /** Npubs every message goes to. */
    readonly recipients?: readonly string[];
    /** Where every copy goes. */
    readonly relays?: readonly string[];
    readonly publish?: Publish;
    readonly now?: () => number;
  } = {},
): Promise<Response> => {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "POST") {
    return json({ status: "ERROR", reason: "Method not allowed." }, 405);
  }

  const contact = parseContactMessage(await request.json().catch(() => null));
  if (contact === null) {
    return json(
      { status: "ERROR", reason: "Expected a contact message." },
      400,
    );
  }

  // A bot filled the field the form never shows: answer as if sent, so it
  // learns nothing, and send nothing.
  if (contact.website !== undefined) return json({ status: "OK" });

  const pubkeys: string[] = [];
  for (const npub of recipients) {
    const pubkey = npubToHex(npub);
    if (pubkey === null) {
      return json(
        {
          status: "ERROR",
          reason: "The contact recipients are misconfigured.",
        },
        500,
      );
    }
    pubkeys.push(pubkey);
  }

  // One key per message: there is nobody to reply to over Nostr, which is
  // why the form asks for an email or a phone.
  const secretKey = generateSecretKey();
  const rumor = createRumor(
    {
      kind: PrivateDirectMessage,
      created_at: Math.floor(now() / 1000),
      content: formatContactMessage(contact),
      tags: [
        ...pubkeys.map((pubkey) => ["p", pubkey]),
        ["subject", contactMessageSubject(contact)],
      ],
    },
    secretKey,
  );

  const results = (
    await Promise.all(
      pubkeys.map((pubkey) =>
        publish(
          relays,
          createWrap(createSeal(rumor, secretKey, pubkey), pubkey),
        ),
      ),
    )
  ).flat();

  if (!results.some((result) => result.status === "fulfilled")) {
    return json(
      { status: "ERROR", reason: "No relay accepted the message." },
      502,
    );
  }
  return json({ status: "OK" });
};

const handleRequest = (request: Request): Promise<Response> =>
  handleContactRequest(request);

export const POST = handleRequest;
export const OPTIONS = handleRequest;

export default { fetch: handleRequest };
