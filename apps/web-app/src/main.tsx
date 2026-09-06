import { Buffer } from "buffer";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import {
  type OpfsProbeIssue,
  prepareEvoluWebStorage,
  shouldUseInMemoryEvoluStorage,
} from "./platform/evoluWebStorage";
import { installIosViewportHeal } from "./platform/iosViewportHeal";
import type {
  BroadcastChannelLike,
  BroadcastMessageHandler,
  LockManagerLike,
} from "./types/browser";
import type { JsonValue } from "./types/json";
import { decodeBase64Url, encodeBase64Url } from "./utils/base64";
import { appendPushDebugLog } from "./utils/pushDebugLog";
import {
  handlePwaUpdateAvailable,
  isApplyingPwaUpdate,
  recordPwaControllerChange,
  recordPwaRegistered,
} from "./utils/pwaUpdate";
import { getUnknownErrorMessage, isRecord } from "./utils/unknown";

type BufferFromArgs =
  | [arrayLike: ArrayLike<number> | ArrayBufferView]
  | [
      arrayBuffer: ArrayBuffer | SharedArrayBuffer,
      byteOffset?: number,
      length?: number,
    ]
  | [value: string, encoding?: string];

interface ProcessLike {
  emitWarning?: (message: string, type?: string, code?: string) => void;
  env?: Record<string, string | undefined>;
}

const isBufferConstructor = (value: unknown): value is typeof Buffer => {
  return typeof value === "function" && "from" in value && "prototype" in value;
};

const getGlobalBuffer = (): typeof Buffer | null => {
  const candidate = Reflect.get(globalThis, "Buffer");
  return isBufferConstructor(candidate) ? candidate : null;
};

const getGlobalProcess = (): object | null => {
  const candidate = Reflect.get(globalThis, "process");
  if (candidate && typeof candidate === "object") {
    return candidate;
  }
  return null;
};

// Some dependencies (e.g. Cashu libs) expect Node's global Buffer.
// Provide a safe browser polyfill.
if (!getGlobalBuffer()) {
  try {
    Object.defineProperty(globalThis, "Buffer", {
      configurable: true,
      value: Buffer,
      writable: true,
    });
  } catch {
    Reflect.set(globalThis, "Buffer", Buffer);
  }
}

// Some browserified Node deps still expect a global `process`.
// Provide a tiny shim before any lazy-loaded app code runs.
if (!getGlobalProcess()) {
  const processShim: ProcessLike = {
    emitWarning: (message: string, type?: string, code?: string) => {
      if (
        typeof console !== "undefined" &&
        typeof console.warn === "function"
      ) {
        console.warn(message, type, code);
      }
    },
    env: {},
  };

  try {
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: processShim,
      writable: true,
    });
  } catch {
    Reflect.set(globalThis, "process", processShim);
  }
}

// The `buffer` polyfill doesn't implement Node's newer "base64url" encoding.
// Some deps (e.g. Evolu) use it for compact URL-safe IDs.
// Patch in minimal support to avoid boot crashes in the browser.
(() => {
  const B = getGlobalBuffer();
  if (!B) return;

  const patchMarker = "__linkyBase64UrlPatched";
  if (Reflect.get(B.prototype, patchMarker) === true) return;

  const origToString = B.prototype.toString;
  Object.defineProperty(B.prototype, "toString", {
    configurable: true,
    value: function (
      this: Buffer,
      encoding?: string,
      start?: number,
      end?: number,
    ) {
      if (encoding === "base64url") {
        return encodeBase64Url(this.subarray(start, end));
      }
      return origToString.call(this, encoding, start, end);
    },
    writable: true,
  });

  const origFrom = B.from;
  Object.defineProperty(B, "from", {
    configurable: true,
    value: function (this: typeof Buffer, ...args: BufferFromArgs) {
      const [value, encodingOrOffset] = args;
      if (typeof value === "string" && encodingOrOffset === "base64url") {
        return Reflect.apply(origFrom, this, [
          decodeBase64Url(value) ?? new Uint8Array(0),
        ]);
      }
      return Reflect.apply(origFrom, this, args);
    },
    writable: true,
  });

  Reflect.set(B.prototype, patchMarker, true);
})();

const updateSW = registerSW({
  immediate: true,
  onOfflineReady() {
    appendPushDebugLog("client", "pwa offline ready");
  },
  onNeedRefresh() {
    appendPushDebugLog("client", "pwa update available");
    void handlePwaUpdateAvailable();
  },
  onRegisteredSW(swUrl, registration) {
    appendPushDebugLog("client", "pwa sw registered", {
      hasActive: Boolean(registration?.active),
      hasInstalling: Boolean(registration?.installing),
      hasWaiting: Boolean(registration?.waiting),
      scope: registration?.scope ?? null,
      swUrl,
    });

    // vite-plugin-pwa does not auto-poll for SW updates when an
    // onRegisteredSW callback is supplied. Trigger manual update checks
    // on a 30s interval plus on focus/visibility/online so an update is
    // noticed shortly after a deploy. Detected waiting workers fire the
    // onNeedRefresh callback above, which either auto-applies the update
    // (fresh untouched single-tab load) or shows the prompt banner.
    if (!registration) return;
    const checkForUpdate = () => {
      if (
        typeof navigator !== "undefined" &&
        "onLine" in navigator &&
        navigator.onLine === false
      ) {
        return;
      }
      void registration.update().catch((error) => {
        appendPushDebugLog("client", "pwa sw update check failed", { error });
      });
    };
    setInterval(checkForUpdate, 30_000);
    if (typeof window !== "undefined") {
      window.addEventListener("focus", checkForUpdate);
      window.addEventListener("online", checkForUpdate);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkForUpdate();
      });
    }
    if (registration.waiting) {
      appendPushDebugLog(
        "client",
        "pwa waiting worker present at registration",
      );
      void handlePwaUpdateAvailable();
    }
  },
  onRegisterError(error) {
    appendPushDebugLog("client", "pwa sw register error", { error });
  },
});
recordPwaRegistered(updateSW);

if ("serviceWorker" in navigator) {
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);
  appendPushDebugLog("client", "pwa controller snapshot", {
    hasController: hadControllerAtLoad,
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    appendPushDebugLog("client", "pwa sw message", {
      data: event.data,
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    recordPwaControllerChange();
    appendPushDebugLog("client", "pwa controller change", {
      hasController: Boolean(navigator.serviceWorker.controller),
    });
    // An update accepted in another tab activated a new SW for every tab.
    // Reload so this tab doesn't keep running old assets against the new
    // SW's purged precache. Skipped on first install (no controller at
    // load) and in the tab that initiated the update (it reloads itself).
    if (hadControllerAtLoad && !isApplyingPwaUpdate()) {
      window.location.reload();
    }
  });

  void navigator.serviceWorker.ready
    .then(async (reg) => {
      appendPushDebugLog("client", "pwa sw ready", {
        hasActive: Boolean(reg.active),
        scope: reg.scope,
      });

      if ("caches" in globalThis) {
        const keys = await caches.keys();
        const relevant = keys.filter(
          (k) => k.includes("workbox") || k.includes("linky"),
        );
        appendPushDebugLog("client", "pwa cache keys", {
          keys: relevant,
        });
      }
    })
    .catch((error) => {
      appendPushDebugLog("client", "pwa sw ready error", { error });
    });
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const getErrorName = (value: unknown): string | null => {
  if (value instanceof DOMException) {
    return value.name;
  }
  if (value instanceof Error) {
    return value.name;
  }
  if (!isRecord(value)) {
    return null;
  }
  const name = value.name;
  return typeof name === "string" ? name : null;
};

const isClipboardReadPermissionError = (value: unknown): boolean => {
  const name = getErrorName(value);
  const message = getUnknownErrorMessage(value, "").toLowerCase();

  if (name !== "NotAllowedError") {
    return false;
  }

  return message.includes("readtext") && message.includes("permission denied");
};

const isBenignFetchAbortError = (value: unknown): boolean => {
  const name = getErrorName(value);
  const message = getUnknownErrorMessage(value, "").toLowerCase();

  if (name === "AbortError") return true;
  // Safari surfaces aborted/cancelled fetches as plain `TypeError: Load failed`
  // or `Fetch is aborted` — both are benign during navigation / tab suspension.
  if (message.includes("fetch is aborted")) return true;
  if (name === "TypeError" && message === "load failed") return true;

  return false;
};

let appHasMounted = false;

const DYNAMIC_IMPORT_FETCH_RELOAD_KEY =
  "linky.boot.dynamic_import_fetch_reload_at.v2";
const DYNAMIC_IMPORT_FETCH_RETRY_COOLDOWN_MS = 10_000;

const isLocalDevOrigin = (): boolean => {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
};

const isDynamicImportFetchError = (value: unknown): boolean => {
  const message = getUnknownErrorMessage(value, "").toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module")
  );
};

const hasRecentlyRetriedDynamicImportFetch = (): boolean => {
  try {
    const raw = window.sessionStorage.getItem(DYNAMIC_IMPORT_FETCH_RELOAD_KEY);
    if (!raw) return false;

    const lastRetryAt = Number(raw);
    return (
      Number.isFinite(lastRetryAt) &&
      Date.now() - lastRetryAt < DYNAMIC_IMPORT_FETCH_RETRY_COOLDOWN_MS
    );
  } catch {
    return false;
  }
};

const markDynamicImportFetchRetry = () => {
  try {
    window.sessionStorage.setItem(
      DYNAMIC_IMPORT_FETCH_RELOAD_KEY,
      String(Date.now()),
    );
  } catch {
    // ignore storage failures; the reload is still useful in dev
  }
};

const clearDynamicImportFetchRetry = () => {
  try {
    window.sessionStorage.removeItem(DYNAMIC_IMPORT_FETCH_RELOAD_KEY);
  } catch {
    // ignore
  }
};

const recoverFromLocalDynamicImportFetch = async (
  stage: string,
  error: unknown,
): Promise<boolean> => {
  if (
    stage !== "import-app" ||
    !isLocalDevOrigin() ||
    !isDynamicImportFetchError(error) ||
    hasRecentlyRetriedDynamicImportFetch()
  ) {
    return false;
  }

  markDynamicImportFetchRetry();
  console.warn(
    "[linky][boot] retrying after dev dynamic import fetch failure",
    {
      href: window.location.href,
    },
  );

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) => {
          return new URL(registration.scope).origin === window.location.origin;
        })
        .map((registration) => registration.unregister()),
    );
  }

  if ("caches" in globalThis) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }

  window.location.reload();
  return true;
};

const applyEvoluWebCompatPolyfills = () => {
  // Some iOS/WebKit environments (notably private browsing) may lack
  // `navigator.locks` and/or `BroadcastChannel`, which Evolu's shared worker
  // implementation depends on. These lightweight polyfills make Evolu fall
  // back to a single-tab worker model instead of crashing during boot.
  if (typeof document === "undefined") return;

  const ensureBroadcastChannel = () => {
    const BC = globalThis.BroadcastChannel;
    if (typeof BC === "undefined") return false;
    try {
      const test = new BC("__linky_test__");
      test.close();
      return true;
    } catch {
      return false;
    }
  };

  if (!ensureBroadcastChannel()) {
    type Listener = BroadcastMessageHandler;
    const channelsByName = new Map<string, Set<PolyBroadcastChannel>>();

    class PolyBroadcastChannel implements BroadcastChannelLike {
      readonly name: string;
      onmessage: Listener = null;

      constructor(name: string) {
        this.name = name;
        const set = channelsByName.get(this.name) ?? new Set();
        set.add(this);
        channelsByName.set(this.name, set);
      }

      postMessage(message: JsonValue) {
        const set = channelsByName.get(this.name);
        if (!set) return;
        for (const ch of set) {
          const handler = ch.onmessage;
          if (!handler) continue;
          try {
            handler(new MessageEvent("message", { data: message }));
          } catch {
            // ignore
          }
        }
      }

      close() {
        const set = channelsByName.get(this.name);
        if (!set) return;
        set.delete(this);
        if (set.size === 0) channelsByName.delete(this.name);
      }

      // Evolu only assigns onmessage, so the EventTarget surface is inert.
      addEventListener() {}

      removeEventListener() {}

      dispatchEvent() {
        return false;
      }
    }

    Object.defineProperty(globalThis, "BroadcastChannel", {
      value: PolyBroadcastChannel,
      configurable: true,
      writable: true,
    });
  }

  const nav = navigator;
  const locks = nav.locks;

  if (!locks?.request) {
    const lockPolyfill: LockManagerLike = {
      request: async (_name: string, cb: () => Promise<JsonValue>) => cb(),
    };
    try {
      if (!Reflect.set(navigator, "locks", lockPolyfill))
        throw new Error("Cannot assign navigator.locks");
    } catch {
      try {
        Object.defineProperty(navigator, "locks", {
          value: lockPolyfill,
          configurable: true,
        });
      } catch {
        // ignore
      }
    }
  }
};

const renderBootError = (error: unknown) => {
  const root = document.getElementById("root");
  if (!root) return;

  const message =
    error instanceof Error
      ? `${error.message}\n\n${error.stack ?? ""}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error, null, 2);

  const diagnostics = {
    href: globalThis.location?.href ?? null,
    userAgent: globalThis.navigator?.userAgent ?? null,
    isSecureContext:
      typeof globalThis.isSecureContext === "boolean"
        ? globalThis.isSecureContext
        : null,
    hasWorker: typeof globalThis.Worker !== "undefined",
    hasBroadcastChannel: typeof globalThis.BroadcastChannel !== "undefined",
    hasLocks: Boolean(globalThis.navigator?.locks),
    hasIndexedDB: typeof globalThis.indexedDB !== "undefined",
    hasStorage: typeof globalThis.navigator?.storage !== "undefined",
  };

  root.innerHTML = `
    <div style="padding: 40px; color: #ff6b6b; font-family: monospace;">
      <h2>Boot error</h2>
      <pre style="overflow: auto; background: #1a1a1a; padding: 10px; white-space: pre-wrap;">${escapeHtml(
        message,
      )}</pre>
      <pre style="overflow: auto; background: #111827; padding: 10px; white-space: pre-wrap; margin-top: 12px;">${escapeHtml(
        JSON.stringify(diagnostics, null, 2),
      )}</pre>
    </div>
  `;
};

const TEMPORARY_SESSION_PROMPT_ID = "linky-temporary-session-prompt";

// Full-screen overlay asking the user to opt into an in-memory session when
// OPFS is unavailable or unresponsive. Resolves on the button click; never
// resolves if the user keeps waiting (a recovered probe dismisses it instead).
const showTemporarySessionPrompt = (issue: OpfsProbeIssue): Promise<void> => {
  const isCzech = navigator.language.toLowerCase().startsWith("cs");

  const panel = document.createElement("div");
  panel.id = TEMPORARY_SESSION_PROMPT_ID;
  panel.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;background:#020617;color:#f9fbfc;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:center";

  const content = document.createElement("div");
  content.style.cssText =
    "display:grid;gap:14px;max-width:420px;justify-items:center";

  const title = document.createElement("h1");
  title.style.cssText = "font-size:20px;margin:0";
  title.textContent =
    issue === "unavailable"
      ? isCzech
        ? "Úložiště zařízení není dostupné"
        : "Device storage is unavailable"
      : isCzech
        ? "Načítání trvá déle než obvykle"
        : "Loading is taking longer than usual";

  const description = document.createElement("p");
  description.style.cssText =
    "font-size:14px;line-height:1.5;opacity:.85;margin:0";
  description.textContent =
    issue === "unavailable"
      ? isCzech
        ? "Tento prohlížeč nemůže na tomto zařízení ukládat data aplikace (typické pro anonymní režim). Můžete pokračovat v dočasné relaci — synchronizovaná data se načtou, ale na tomto zařízení se nic neuloží."
        : "This browser can't save app data on this device (typical for private browsing). You can continue with a temporary session — your synced data will still load, but nothing will be saved on this device."
      : isCzech
        ? "Úložiště zařízení zatím neodpovídá. Můžete počkat, nebo pokračovat v dočasné relaci — synchronizovaná data se načtou, ale na tomto zařízení se nic neuloží."
        : "This device's storage isn't responding yet. You can keep waiting, or continue with a temporary session — your synced data will still load, but nothing will be saved on this device.";

  const continueButton = document.createElement("button");
  continueButton.type = "button";
  continueButton.style.cssText =
    "border:0;border-radius:12px;padding:12px 18px;background:#14b8a6;color:#020617;font:inherit;font-weight:700;cursor:pointer";
  continueButton.textContent = isCzech
    ? "Pokračovat v dočasné relaci"
    : "Continue with temporary session";

  content.append(title, description, continueButton);
  panel.append(content);
  document.body.append(panel);

  return new Promise((resolve) => {
    continueButton.addEventListener(
      "click",
      () => {
        continueButton.disabled = true;
        resolve();
      },
      { once: true },
    );
  });
};

const removeTemporarySessionPrompt = () => {
  document.getElementById(TEMPORARY_SESSION_PROMPT_ID)?.remove();
};

const bootstrap = async () => {
  let stage = "init";
  let appCommitRecorded = false;
  // Surface a stuck-loading state with the last completed boot stage so we
  // can tell whether bootstrap froze in dynamic imports, polyfills, or the
  // first render. Mostly catches iOS Safari private-mode quirks where a
  // dependency hangs without throwing.
  let stuckTimer = 0;
  const armStuckTimer = () => {
    stuckTimer = window.setTimeout(() => {
      renderBootError(new Error(`Boot stuck after 15s at stage: ${stage}`));
    }, 15_000);
  };
  armStuckTimer();
  try {
    console.log("[linky][boot] start");
    stage = "polyfills";
    applyEvoluWebCompatPolyfills();
    installIosViewportHeal();
    console.log("[linky][boot] polyfills done");

    stage = "storage-compat";
    let storagePromptShown = false;
    await prepareEvoluWebStorage({
      requestInMemoryConsent: (issue) => {
        // The prompt waits for a user decision; pause both boot watchdogs so
        // neither the stuck-boot error nor the index.html shell recovery
        // reload replaces the screen in the meantime.
        storagePromptShown = true;
        window.clearTimeout(stuckTimer);
        window.dispatchEvent(new Event("linky-boot-decision-pending"));
        return showTemporarySessionPrompt(issue);
      },
    });
    if (storagePromptShown) {
      removeTemporarySessionPrompt();
      armStuckTimer();
      window.dispatchEvent(new Event("linky-boot-decision-resolved"));
    }
    console.log("[linky][boot] storage compatibility checked", {
      inMemory: shouldUseInMemoryEvoluStorage(),
    });

    stage = "import-app";
    const [{ default: App }, { ErrorBoundary }] = await Promise.all([
      import("./App.tsx"),
      import("./ErrorBoundary.tsx"),
    ]);
    console.log("[linky][boot] app modules loaded");

    stage = "import-evolu";
    const { evolu, EvoluProvider } = await import("./evolu.ts");
    console.log("[linky][boot] evolu loaded");

    stage = "await-render-commit";
    const root = createRoot(document.getElementById("root")!);
    const recordAppCommit = () => {
      if (appCommitRecorded) return;
      appCommitRecorded = true;
      stage = "mounted";
      window.clearTimeout(stuckTimer);
      appHasMounted = true;
      window.dispatchEvent(new Event("linky-app-mounted"));
      clearDynamicImportFetchRetry();
    };
    flushSync(() => {
      root.render(
        <StrictMode>
          <EvoluProvider value={evolu}>
            <ErrorBoundary>
              <App onCommit={recordAppCommit} />
            </ErrorBoundary>
          </EvoluProvider>
        </StrictMode>,
      );
    });
    console.log("[linky][boot] render scheduled");
  } catch (error) {
    window.clearTimeout(stuckTimer);
    console.error(`Boot failed at stage ${stage}:`, error);
    if (await recoverFromLocalDynamicImportFetch(stage, error)) return;
    const wrapped =
      error instanceof Error
        ? Object.assign(error, {
            message: `[stage: ${stage}] ${error.message}`,
          })
        : new Error(`[stage: ${stage}] ${String(error)}`);
    renderBootError(wrapped);
  }
};

window.addEventListener("unhandledrejection", (event) => {
  if (isClipboardReadPermissionError(event.reason)) {
    event.preventDefault();
    return;
  }
  if (isBenignFetchAbortError(event.reason)) {
    event.preventDefault();
    return;
  }
  if (appHasMounted) {
    console.error("[linky] post-mount unhandled rejection", event.reason);
    return;
  }
  renderBootError(event.reason);
});

window.addEventListener("error", (event) => {
  const error = event.error ?? event.message;
  if (isClipboardReadPermissionError(error)) {
    event.preventDefault();
    return;
  }
  if (isBenignFetchAbortError(error)) {
    event.preventDefault();
    return;
  }
  if (appHasMounted) {
    console.error("[linky] post-mount window error", error);
    return;
  }
  renderBootError(error);
});

void bootstrap();
