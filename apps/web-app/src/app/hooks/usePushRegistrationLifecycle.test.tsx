import { act } from "react";
import type { Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { usePushRegistrationLifecycle } from "./usePushRegistrationLifecycle";

const platformMocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
}));

const pushMocks = vi.hoisted(() => ({
  arePushNotificationsDisabledByUser: vi.fn(() => false),
  registerPushNotifications: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../../platform/runtime", () => platformMocks);
vi.mock("../../utils/pushNotifications", () => pushMocks);

interface HarnessProps {
  currentNsec: string | null;
  enabled: boolean;
}

const Harness = ({ currentNsec, enabled }: HarnessProps): null => {
  usePushRegistrationLifecycle({ currentNsec, enabled });
  return null;
};

const mountedRoots = new Set<Root>();
let notificationPermission: NotificationPermission;
let requestPermission: ReturnType<
  typeof vi.fn<() => Promise<NotificationPermission>>
>;
let serviceWorkerTarget: EventTarget;
let originalNotificationDescriptor: PropertyDescriptor | undefined;
let originalPushManagerDescriptor: PropertyDescriptor | undefined;
let originalServiceWorkerDescriptor: PropertyDescriptor | undefined;
let originalVisibilityDescriptor: PropertyDescriptor | undefined;

const setVisibility = (value: DocumentVisibilityState): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
};

const installWebPushCapabilities = (): void => {
  serviceWorkerTarget = new EventTarget();
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: serviceWorkerTarget,
  });
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: class {},
  });
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: {
      get permission() {
        return notificationPermission;
      },
      requestPermission,
    },
  });
};

const renderLifecycle = async ({
  currentNsec = "nsec-test",
  enabled = true,
}: Partial<HarnessProps> = {}): Promise<Root> => {
  const { root } = await renderIntoDocument(
    <Harness currentNsec={currentNsec} enabled={enabled} />,
  );
  mountedRoots.add(root);
  return root;
};

// Registration only happens after the hook's dynamic import settles, which
// takes more than one microtask, so drain the queue instead of a fixed tick.
const flushLifecycle = async (): Promise<void> => {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) {
      await Promise.resolve();
    }
  });
};

const restoreProperty = (
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void => {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
};

// Warm the module registry so the hook's dynamic import resolves from cache
// rather than needing a macrotask that fake timers would never run.
beforeAll(async () => {
  await import("../../utils/pushNotifications");
});

beforeEach(() => {
  vi.clearAllMocks();
  originalNotificationDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "Notification",
  );
  originalPushManagerDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "PushManager",
  );
  originalServiceWorkerDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "serviceWorker",
  );
  originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  notificationPermission = "granted";
  requestPermission = vi.fn().mockResolvedValue("granted");
  platformMocks.isNativePlatform.mockReturnValue(false);
  pushMocks.arePushNotificationsDisabledByUser.mockReturnValue(false);
  pushMocks.registerPushNotifications.mockResolvedValue({ success: true });
  setVisibility("visible");
  installWebPushCapabilities();
});

afterEach(async () => {
  for (const root of mountedRoots) {
    await act(async () => {
      root.unmount();
    });
  }
  mountedRoots.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreProperty(window, "Notification", originalNotificationDescriptor);
  restoreProperty(window, "PushManager", originalPushManagerDescriptor);
  restoreProperty(navigator, "serviceWorker", originalServiceWorkerDescriptor);
  restoreProperty(document, "visibilityState", originalVisibilityDescriptor);
});

describe("usePushRegistrationLifecycle", () => {
  it("does not initialize while disabled or without an nsec", async () => {
    const root = await renderLifecycle({ enabled: false });
    await flushLifecycle();

    await act(async () => {
      root.render(<Harness currentNsec={null} enabled />);
    });
    await flushLifecycle();

    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushMocks.registerPushNotifications).not.toHaveBeenCalled();
  });

  it("honors the user-disabled notification preference", async () => {
    pushMocks.arePushNotificationsDisabledByUser.mockReturnValue(true);

    await renderLifecycle();
    await flushLifecycle();

    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushMocks.registerPushNotifications).not.toHaveBeenCalled();
  });

  it("registers immediately when web notification permission is granted", async () => {
    await renderLifecycle();
    await flushLifecycle();

    expect(requestPermission).not.toHaveBeenCalled();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledWith(
      "nsec-test",
    );
  });

  it("requests default web permission and registers only when granted", async () => {
    notificationPermission = "default";
    requestPermission.mockResolvedValueOnce("denied");
    const root = await renderLifecycle();
    await flushLifecycle();

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(pushMocks.registerPushNotifications).not.toHaveBeenCalled();

    requestPermission.mockResolvedValueOnce("granted");
    await act(async () => {
      root.render(<Harness currentNsec="nsec-next" enabled />);
    });
    await flushLifecycle();

    expect(requestPermission).toHaveBeenCalledTimes(2);
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledWith(
      "nsec-next",
    );
  });

  it("delegates native startup without requiring browser push APIs", async () => {
    platformMocks.isNativePlatform.mockReturnValue(true);
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(window, "PushManager");
    Reflect.deleteProperty(navigator, "serviceWorker");

    await renderLifecycle();
    await flushLifecycle();

    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledWith(
      "nsec-test",
    );
  });

  it("revalidates native registration after returning to the foreground", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    platformMocks.isNativePlatform.mockReturnValue(true);
    Reflect.deleteProperty(window, "Notification");
    Reflect.deleteProperty(window, "PushManager");
    Reflect.deleteProperty(navigator, "serviceWorker");

    await renderLifecycle();
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();

    pushMocks.registerPushNotifications.mockClear();
    window.dispatchEvent(new Event("focus"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    window.dispatchEvent(new Event("focus"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledWith(
      "nsec-test",
    );
  });

  it("revalidates only while visible and respects the 12-hour cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await renderLifecycle();
    await flushLifecycle();
    pushMocks.registerPushNotifications.mockClear();

    setVisibility("hidden");
    window.dispatchEvent(new Event("focus"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).not.toHaveBeenCalled();

    setVisibility("visible");
    window.dispatchEvent(new Event("focus"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event("online"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    window.dispatchEvent(new Event("focus"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledTimes(2);
  });

  it("allows failed revalidation to retry after five minutes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await renderLifecycle();
    await flushLifecycle();
    pushMocks.registerPushNotifications.mockClear();
    pushMocks.registerPushNotifications.mockResolvedValueOnce({
      success: false,
      error: "offline",
    });

    window.dispatchEvent(new Event("focus"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    window.dispatchEvent(new Event("focus"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    window.dispatchEvent(new Event("focus"));
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledTimes(2);
  });

  it("throttles push-received messages but forces subscription-change refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await renderLifecycle();
    await flushLifecycle();
    pushMocks.registerPushNotifications.mockClear();

    serviceWorkerTarget.dispatchEvent(
      new MessageEvent("message", { data: { type: "push-received" } }),
    );
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();

    serviceWorkerTarget.dispatchEvent(
      new MessageEvent("message", { data: { type: "push-received" } }),
    );
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledOnce();

    serviceWorkerTarget.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "push-subscription-change" },
      }),
    );
    await flushLifecycle();
    expect(pushMocks.registerPushNotifications).toHaveBeenCalledTimes(2);
  });

  it("ignores unrecognized service-worker messages", async () => {
    await renderLifecycle();
    await flushLifecycle();
    pushMocks.registerPushNotifications.mockClear();

    serviceWorkerTarget.dispatchEvent(
      new MessageEvent("message", { data: { type: "other" } }),
    );
    await flushLifecycle();

    expect(pushMocks.registerPushNotifications).not.toHaveBeenCalled();
  });

  it("stops registering on foreground and service-worker events after unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const root = await renderLifecycle();
    await flushLifecycle();
    pushMocks.registerPushNotifications.mockClear();

    await act(async () => {
      root.unmount();
    });
    mountedRoots.delete(root);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    serviceWorkerTarget.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "push-subscription-change" },
      }),
    );
    await flushLifecycle();

    expect(pushMocks.registerPushNotifications).not.toHaveBeenCalled();
  });
});
