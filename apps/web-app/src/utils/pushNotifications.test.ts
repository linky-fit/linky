import { getPublicKey, nip19 } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../testUtils/nostrKeys";
import {
  registerPushNotifications,
  unregisterPushNotifications,
} from "./pushNotifications";

const runtimeMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
}));

const nativePushMocks = vi.hoisted(() => ({
  unregister: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../platform/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../platform/runtime")>();
  return {
    ...actual,
    isNativePlatform: runtimeMocks.isNativePlatform,
  };
});

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: nativePushMocks,
}));

vi.mock("./pushDebugLog", () => ({
  appendPushDebugLog: vi.fn(),
}));

const SECRET_KEY = createSecretKey(7);
const NSEC = nip19.nsecEncode(SECRET_KEY);
const PUBKEY = getPublicKey(SECRET_KEY);
const VAPID_KEY = "AQID";

interface RecordedRequest {
  body: unknown;
  url: string;
}

let originalServiceWorkerDescriptor: PropertyDescriptor | undefined;
let recordedRequests: RecordedRequest[];
let subscribeSucceeds: boolean;

const isRecord = (
  value: unknown,
): value is Record<string | number | symbol, unknown> =>
  typeof value === "object" && value !== null;

const parseBody = (body: BodyInit | null | undefined): unknown => {
  if (typeof body !== "string") return null;
  return JSON.parse(body);
};

const readRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const createSubscription = (
  endpoint: string,
  applicationServerKey: number[],
) => {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  return {
    endpoint,
    expirationTime: null,
    getKey: vi.fn((name: PushEncryptionKeyName) => {
      return new Uint8Array(name === "auth" ? [4, 5] : [6, 7]).buffer;
    }),
    options: {
      applicationServerKey: new Uint8Array(applicationServerKey).buffer,
      userVisibleOnly: true,
    },
    unsubscribe,
  };
};

const installServiceWorker = (
  activeSubscription: ReturnType<typeof createSubscription>,
  replacementSubscription = activeSubscription,
) => {
  const getSubscription = vi.fn().mockResolvedValue(activeSubscription);
  const subscribe = vi.fn().mockResolvedValue(replacementSubscription);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        active: {},
        pushManager: {
          getSubscription,
          subscribe,
        },
      }),
    },
  });
  return { getSubscription, subscribe };
};

const getSubscribeRequests = (): RecordedRequest[] =>
  recordedRequests.filter(({ url }) => url.endsWith("/subscribe"));

const readField = (value: unknown, field: string): unknown =>
  isRecord(value) ? value[field] : undefined;

beforeEach(() => {
  localStorage.clear();
  originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "serviceWorker",
  );
  recordedRequests = [];
  subscribeSucceeds = true;
  runtimeMocks.isNativePlatform.mockReturnValue(false);
  nativePushMocks.unregister.mockResolvedValue(undefined);

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = readRequestUrl(input);
      const body = parseBody(init?.body);
      recordedRequests.push({ body, url });

      if (url.endsWith("/vapid-public-key")) {
        return Response.json({ vapidPublicKey: VAPID_KEY });
      }
      if (url.endsWith("/auth/challenge")) {
        const requestedAction = readField(body, "action");
        const action =
          requestedAction === "unsubscribe" ? "unsubscribe" : "subscribe";
        return Response.json({
          action,
          challenge: `challenge-${action}`,
          expiresAt: Date.now() + 60_000,
          pubkey: PUBKEY,
        });
      }
      if (url.endsWith("/subscribe")) {
        return new Response(subscribeSucceeds ? "" : "registration failed", {
          status: subscribeSucceeds ? 200 : 500,
        });
      }
      if (url.endsWith("/unsubscribe")) {
        return new Response("", { status: 200 });
      }
      return new Response("", { status: 404 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalServiceWorkerDescriptor) {
    Object.defineProperty(
      navigator,
      "serviceWorker",
      originalServiceWorkerDescriptor,
    );
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
});

describe("registerPushNotifications browser lifecycle", () => {
  it("reuses a subscription with the current VAPID key and persists registration", async () => {
    const subscription = createSubscription(
      "https://push.example/current",
      [1, 2, 3],
    );
    const pushManager = installServiceWorker(subscription);

    await expect(registerPushNotifications(NSEC)).resolves.toEqual({
      success: true,
    });

    expect(subscription.unsubscribe).not.toHaveBeenCalled();
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem("linky.push_vapid_public_key")).toBe(VAPID_KEY);
    expect(localStorage.getItem("linky.push_subscription_endpoint")).toBe(
      subscription.endpoint,
    );
    expect(localStorage.getItem("linky.push_subscription_pubkey")).toBe(PUBKEY);
  });

  it("replaces a mismatched VAPID subscription and cleans up its endpoint", async () => {
    const staleSubscription = createSubscription(
      "https://push.example/stale",
      [9, 9, 9],
    );
    const replacementSubscription = createSubscription(
      "https://push.example/replacement",
      [1, 2, 3],
    );
    const pushManager = installServiceWorker(
      staleSubscription,
      replacementSubscription,
    );

    await expect(registerPushNotifications(NSEC)).resolves.toEqual({
      success: true,
    });

    expect(staleSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledOnce();
    expect(pushManager.subscribe).toHaveBeenCalledWith({
      applicationServerKey: new Uint8Array([1, 2, 3]).buffer,
      userVisibleOnly: true,
    });
    expect(
      recordedRequests.some(
        ({ body, url }) =>
          url.endsWith("/unsubscribe") &&
          readField(body, "endpoint") === staleSubscription.endpoint,
      ),
    ).toBe(true);
    expect(localStorage.getItem("linky.push_subscription_endpoint")).toBe(
      replacementSubscription.endpoint,
    );
  });

  it("creates one installation ID and reuses it on later registrations", async () => {
    const subscription = createSubscription(
      "https://push.example/current",
      [1, 2, 3],
    );
    installServiceWorker(subscription);

    await registerPushNotifications(NSEC);
    await registerPushNotifications(NSEC);

    const subscribeRequests = getSubscribeRequests();
    expect(subscribeRequests).toHaveLength(2);
    const firstInstallationId = readField(
      subscribeRequests[0]?.body,
      "installationId",
    );
    expect(typeof firstInstallationId).toBe("string");
    expect(firstInstallationId).not.toBe("");
    expect(readField(subscribeRequests[1]?.body, "installationId")).toBe(
      firstInstallationId,
    );
    expect(localStorage.getItem("linky.push_installation_id")).toBe(
      firstInstallationId,
    );
  });

  it("does not overwrite stored registration identity after server failure", async () => {
    localStorage.setItem(
      "linky.push_subscription_endpoint",
      "https://push.example/previous",
    );
    localStorage.setItem("linky.push_subscription_pubkey", "previous-pubkey");
    const subscription = createSubscription(
      "https://push.example/current",
      [1, 2, 3],
    );
    installServiceWorker(subscription);
    subscribeSucceeds = false;

    const result = await registerPushNotifications(NSEC);

    expect(result.success).toBe(false);
    expect(localStorage.getItem("linky.push_subscription_endpoint")).toBe(
      "https://push.example/previous",
    );
    expect(localStorage.getItem("linky.push_subscription_pubkey")).toBe(
      "previous-pubkey",
    );
  });
});

describe("unregisterPushNotifications native lifecycle", () => {
  it("succeeds locally when no server-side token was stored", async () => {
    runtimeMocks.isNativePlatform.mockReturnValue(true);

    await expect(unregisterPushNotifications(NSEC)).resolves.toBe(true);

    expect(nativePushMocks.unregister).toHaveBeenCalledOnce();
    expect(
      recordedRequests.some(({ url }) => url.endsWith("/native/unsubscribe")),
    ).toBe(false);
    expect(localStorage.getItem("linky.push_notifications_disabled")).toBe("1");
  });
});
