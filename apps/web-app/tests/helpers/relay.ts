import {
  expect,
  type Page,
  type WebSocket as PlaywrightWebSocket,
} from "@playwright/test";
import { Option, Schema } from "effect";
import { finalizeEvent, nip19 } from "nostr-tools";

const LOCAL_RELAY_URL = "ws://localhost:7777";

const decodeSubscriptionFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Union([
      Schema.Tuple([
        Schema.Literal("REQ"),
        Schema.String,
        Schema.Struct({
          kinds: Schema.Array(Schema.Number),
          "#p": Schema.Array(Schema.String),
        }),
      ]),
      Schema.Tuple([Schema.Literals(["EOSE", "CLOSE"]), Schema.String]),
    ]),
  ),
);

/** Register before navigation; wallet rendering precedes the inbox subscription. */
export const watchNostrInbox = (
  page: Page,
  npub: string,
): (() => Promise<void>) => {
  const pubkey = npubToHex(npub);
  const readySockets = new Set<PlaywrightWebSocket>();
  page.on("websocket", (socket) => {
    if (socket.url().replace(/\/$/, "") !== LOCAL_RELAY_URL) return;
    let inboxSubscriptionId: string | null = null;
    socket.on("framesent", ({ payload }) => {
      const decoded = decodeSubscriptionFrame(String(payload));
      if (Option.isNone(decoded)) return;
      const frame = decoded.value;
      if (
        frame[0] === "REQ" &&
        frame[2].kinds.includes(1059) &&
        frame[2]["#p"].includes(pubkey)
      ) {
        inboxSubscriptionId = frame[1];
        readySockets.delete(socket);
      } else if (frame[0] === "CLOSE" && frame[1] === inboxSubscriptionId) {
        inboxSubscriptionId = null;
        readySockets.delete(socket);
      }
    });
    socket.on("framereceived", ({ payload }) => {
      const decoded = decodeSubscriptionFrame(String(payload));
      if (Option.isNone(decoded)) return;
      const frame = decoded.value;
      if (frame[0] === "EOSE" && frame[1] === inboxSubscriptionId) {
        readySockets.add(socket);
      }
    });
    socket.on("close", () => readySockets.delete(socket));
  });
  return async () => {
    await expect
      .poll(() => readySockets.size, {
        message: "the app's gift-wrap inbox has subscribed and received EOSE",
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
  };
};

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

const nsecToSecretKey = (nsec: string): Uint8Array => {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") throw new Error("Not an nsec");
  return decoded.data;
};

/**
 * Publish the NIP-38 general status the app would publish from Settings >
 * Payments > Proxy payments. The switch there first enables push
 * notifications, which a service-worker-blocked test browser cannot do, so the
 * test signs the same `kind:30315` event itself; the relay does not care who
 * pressed the switch.
 */
export const publishProfileStatusToRelay = async (
  nsec: string,
  currencies: readonly string[],
): Promise<void> => {
  const event = finalizeEvent(
    {
      content: currencies.join(", "),
      created_at: Math.floor(Date.now() / 1000),
      kind: 30315,
      tags: [["d", "general"]],
    },
    nsecToSecretKey(nsec),
  );

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(LOCAL_RELAY_URL);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("relay publish timed out"));
    }, 10_000);
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("relay socket error"));
    };
    socket.onopen = () => socket.send(JSON.stringify(["EVENT", event]));
    socket.onmessage = (message) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!Array.isArray(parsed) || parsed[0] !== "OK") return;
      clearTimeout(timer);
      socket.close();
      if (parsed[2] === true) resolve();
      else reject(new Error(`relay rejected status: ${String(parsed[3])}`));
    };
  });
};

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
