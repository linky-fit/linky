import { Schema } from "effect";
import { nip19 } from "nostr-tools";

const LOCAL_RELAY_URL = "ws://localhost:7777";

const npubToHex = (npub: string): string => {
  const decoded = nip19.decode(npub);
  if (decoded.type !== "npub" || typeof decoded.data !== "string") {
    throw new Error(`Not an npub: ${npub}`);
  }
  return decoded.data;
};

interface NostrEventShape {
  content: string;
  kind: number;
  pubkey: string;
  tags: string[][];
}

const isEventShape = (value: unknown): value is NostrEventShape => {
  return Schema.is(
    Schema.Struct({
      content: Schema.String,
      kind: Schema.Number,
      pubkey: Schema.String,
      tags: Schema.Array(Schema.Array(Schema.String)),
    }),
  )(value);
};

/** One REQ against the local relay, resolving with the events seen before EOSE. */
const queryRelay = (
  filter: Record<string, unknown>,
  timeoutMs: number,
): Promise<NostrEventShape[]> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(LOCAL_RELAY_URL);
    const events: NostrEventShape[] = [];
    const subscriptionId = `e2e-${Math.floor(Date.now() % 1e9)}`;

    const finish = (settle: () => void) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      settle();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`relay query timed out`))),
      timeoutMs,
    );

    socket.onerror = () =>
      finish(() => reject(new Error("relay socket error")));

    socket.onopen = () => {
      socket.send(JSON.stringify(["REQ", subscriptionId, filter]));
    };

    socket.onmessage = (message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!Array.isArray(parsed)) return;

      if (parsed[0] === "EVENT" && isEventShape(parsed[2])) {
        events.push(parsed[2]);
        return;
      }
      if (parsed[0] === "EOSE") finish(() => resolve(events));
    };
  });

/**
 * Block until the account's NIP-38 status is actually on the relay. The status
 * chip flips optimistically, so the UI proves nothing about delivery — and the
 * offerer caches an empty status fetch as null without ever retrying, so the
 * publish must be complete before the offerer adds the contact.
 */
export const waitForProfileStatusOnRelay = async (
  npub: string,
  currency: string,
  timeoutMs = 30_000,
): Promise<void> => {
  const pubkey = npubToHex(npub);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const events = await queryRelay(
      { authors: [pubkey], kinds: [30315], limit: 10 },
      10_000,
    ).catch(() => []);

    const match = events.find(
      (event) =>
        event.tags.some((tag) => tag[0] === "d" && tag[1] === "general") &&
        event.content.toUpperCase().includes(currency.toUpperCase()),
    );
    if (match) return;

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `kind:30315 status containing ${currency} never reached ${LOCAL_RELAY_URL} for ${npub}`,
  );
};
