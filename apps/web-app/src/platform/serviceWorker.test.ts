import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./serviceWorker";

type Listener = (event: { isUpdate?: boolean; isExternal?: boolean }) => void;

const workbox = vi.hoisted(() => ({
  created: new Array<[string, RegistrationOptions]>(),
  listeners: new Map<string, Listener[]>(),
  registration: {},
  messageSkipWaiting: vi.fn(),
  emit(type: string, event: { isUpdate?: boolean; isExternal?: boolean }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  },
}));

vi.mock("workbox-window", () => ({
  Workbox: class {
    constructor(url: string, options: RegistrationOptions) {
      workbox.created.push([url, options]);
    }
    addEventListener(type: string, listener: Listener) {
      workbox.listeners.set(type, [
        ...(workbox.listeners.get(type) ?? []),
        listener,
      ]);
    }
    register() {
      return Promise.resolve(workbox.registration);
    }
    messageSkipWaiting() {
      workbox.messageSkipWaiting();
    }
  },
}));

const reload = vi.fn();
const callbacks = () => ({
  onNeedRefresh: vi.fn(),
  onOfflineReady: vi.fn(),
  onRegistered: vi.fn(),
  onRegisterError: vi.fn(),
});

beforeEach(() => {
  workbox.created.length = 0;
  workbox.listeners.clear();
  workbox.messageSkipWaiting.mockClear();
  reload.mockClear();
  vi.stubGlobal("navigator", { serviceWorker: {} });
  vi.stubGlobal("window", { location: { reload } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// A changed URL, scope or type counts as an update for every installed app.
it.each([
  { dev: false, url: "/sw.js", type: "classic" },
  { dev: true, url: "/dev-sw.js?dev-sw", type: "module" },
])(
  "registers $url as a $type worker, as vite-plugin-pwa did",
  async ({ dev, url, type }) => {
    vi.stubEnv("DEV", dev);
    vi.resetModules();
    const fresh = await import("./serviceWorker");
    fresh.registerServiceWorker(callbacks());
    expect(workbox.created).toEqual([[url, { scope: "/", type }]]);
  },
);

it("reports the registration", async () => {
  const options = callbacks();
  registerServiceWorker(options);
  await vi.waitFor(() =>
    expect(options.onRegistered).toHaveBeenCalledWith(
      expect.stringContaining("sw.js"),
      workbox.registration,
    ),
  );
});

it("prompts for a waiting update and reloads once the accepted worker takes control", async () => {
  const options = callbacks();
  const applyUpdate = registerServiceWorker(options);

  workbox.emit("waiting", {});
  workbox.emit("waiting", {});
  expect(options.onNeedRefresh).toHaveBeenCalledTimes(2);

  await applyUpdate();
  expect(workbox.messageSkipWaiting).toHaveBeenCalledOnce();

  workbox.emit("controlling", { isUpdate: true });
  expect(reload).toHaveBeenCalledOnce();
});

it("prompts for a worker another tab installed", () => {
  const options = callbacks();
  registerServiceWorker(options);
  workbox.emit("installed", { isExternal: true });
  expect(options.onNeedRefresh).toHaveBeenCalledOnce();
  expect(options.onOfflineReady).not.toHaveBeenCalled();
});

it("reports offline readiness for a first install and never reloads for it", () => {
  const options = callbacks();
  registerServiceWorker(options);
  workbox.emit("installed", { isUpdate: false });
  workbox.emit("controlling", { isUpdate: false });
  expect(options.onOfflineReady).toHaveBeenCalledOnce();
  expect(options.onNeedRefresh).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it("does nothing without service worker support", async () => {
  vi.stubGlobal("navigator", {});
  const options = callbacks();
  await registerServiceWorker(options)();
  expect(options.onRegistered).not.toHaveBeenCalled();
  expect(workbox.messageSkipWaiting).not.toHaveBeenCalled();
});
