import { Context, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeIdentity } from "@linky/linkstr/testing";
import { encodeNsec } from "@linky/linkstr";

const state = vi.hoisted(() => ({
  fetchWrapEvent: vi.fn(() => Effect.succeed(null)),
  runConfig: vi.fn(),
  nsec: "",
}));
vi.mock("@linky/linkstr", async (importOriginal) => {
  const original = await importOriginal<typeof import("@linky/linkstr")>();
  interface Inbox {
    fetchWrapEvent: typeof state.fetchWrapEvent;
  }
  const inbox = Context.GenericTag<Inbox>("test/notification-inbox");
  return {
    ...original,
    WrapInbox: inbox,
    runLinkstr: (
      config: unknown,
      effect: Effect.Effect<unknown, unknown, Inbox>,
    ) => {
      state.runConfig(config);
      return Effect.runPromise(Effect.provideService(effect, inbox, state));
    },
  };
});
vi.mock("./utils/nostrRelays", () => ({
  NOSTR_RELAYS: ["wss://configured.example"],
  ALLOW_INSECURE_LOCALHOST_RELAYS: false,
}));
vi.mock("./utils/pushNsecStorage", () => ({
  getStoredPushNsec: async () => state.nsec,
}));
vi.mock("./utils/pushDebugLog", () => ({
  appendPushDebugLog: vi.fn(),
  flushPushDebugLog: async () => {},
}));
vi.mock("./utils/pushContactNamesStorage", () => ({
  getStoredPushContactName: async () => null,
}));
vi.mock("workbox-precaching", () => ({
  precacheAndRoute: vi.fn(),
  createHandlerBoundToURL: vi.fn(),
}));
vi.mock("workbox-routing", () => ({
  registerRoute: vi.fn(),
  NavigationRoute: class {},
}));
vi.mock("workbox-expiration", () => ({ ExpirationPlugin: class {} }));
vi.mock("workbox-strategies", () => ({ CacheFirst: class {} }));

const recipient = makeIdentity();
const data = {
  outerEventId: "a".repeat(64),
  recipientPubkey: recipient.pubkey,
  relayHints: ["wss://attacker.example", "ws://192.168.1.1"],
};
const handlers = new Map<string, (event: unknown) => void>();
const showNotification = vi.fn(async () => {});
const openWindow = vi
  .fn<(url: string) => Promise<void>>()
  .mockResolvedValue(undefined);
const postMessage = vi.fn();
const navigate = vi
  .fn<(url: string) => Promise<void>>()
  .mockResolvedValue(undefined);
const focus = vi.fn(async () => {});
const client = { url: "https://app.linky.fit", postMessage, navigate, focus };
const matchAll = vi.fn(async () => [client]);

async function dispatch(type: string, properties: object) {
  const pending: Promise<void>[] = [];
  const handler = handlers.get(type);
  expect(handler).toBeDefined();
  handler?.({
    ...properties,
    waitUntil: (promise: Promise<void>) => pending.push(promise),
  });
  await Promise.all(pending);
}

beforeEach(async () => {
  vi.clearAllMocks();
  matchAll.mockResolvedValue([]);
  state.nsec = encodeNsec(recipient.secretKey);
  vi.stubGlobal("self", {
    addEventListener: (type: string, callback: (event: unknown) => void) =>
      handlers.set(type, callback),
    clients: { matchAll, openWindow },
    registration: { showNotification },
    navigator: { language: "en" },
  });
  await import("./sw");
});

describe("notification relay routing", () => {
  it("fetches background pushes only from configured relays and strips legacy hints", async () => {
    await dispatch("push", {
      data: { json: () => ({ body: "New message", data }) },
    });
    expect(state.runConfig).toHaveBeenCalledWith({
      secretKey: recipient.secretKey,
      readRelays: ["wss://configured.example"],
      allowInsecureLocalhost: false,
    });
    expect(state.fetchWrapEvent).toHaveBeenCalledWith(data.outerEventId, {
      timeout: 5000,
    });
    expect(showNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        data: {
          outerEventId: data.outerEventId,
          recipientPubkey: data.recipientPubkey,
        },
      }),
    );
  });

  it.each([false, true])(
    "opens a notification with warm client=%s without forwarding legacy hints",
    async (warm) => {
      matchAll.mockResolvedValue(warm ? [client] : []);
      await dispatch("notificationclick", {
        notification: { data, close: vi.fn() },
      });
      const detail = {
        route: "#contacts",
        outerEventId: data.outerEventId,
        recipientPubkey: data.recipientPubkey,
      };
      const url = `/#contacts?${new URLSearchParams({ notificationOpen: JSON.stringify(detail) })}`;
      if (warm) {
        expect(postMessage).toHaveBeenCalledWith({
          type: "notification-open",
          detail,
        });
        expect(navigate).toHaveBeenCalledWith(url);
        expect(focus).toHaveBeenCalled();
      } else {
        expect(openWindow).toHaveBeenCalledWith(url);
      }
    },
  );
});
