import { getUnknownErrorMessage } from "./unknown";

// index.html moves `current` to `previous` before this module loads, so the
// previous attempt survives even a reload whose bundle never starts.
const CURRENT_BOOT_DIAGNOSTICS_KEY = "linky.boot.diagnostics.current.v1";
const PREVIOUS_BOOT_DIAGNOSTICS_KEY = "linky.boot.diagnostics.previous.v1";
const MAX_BOOT_EVENTS = 40;

type BootDiagnosticEventKind = "error" | "stage";

interface BootDiagnosticError {
  componentStack: string | null;
  message: string;
  name: string | null;
  source: string;
  stack: string | null;
}

interface BootDiagnosticEvent {
  at: string;
  elapsedMs: number;
  error: BootDiagnosticError | null;
  kind: BootDiagnosticEventKind;
  stage: string;
}

export interface BootDiagnosticSnapshot {
  app: {
    commit: string;
    version: string;
  };
  currentStage: string;
  events: BootDiagnosticEvent[];
  startedAt: string;
}

interface BootEnvironmentDiagnostics {
  displayModeStandalone: boolean;
  documentVisibility: string;
  features: {
    broadcastChannel: boolean;
    cacheStorage: boolean;
    indexedDb: boolean;
    locks: boolean;
    opfs: boolean;
    serviceWorker: boolean;
    worker: boolean;
  };
  language: string;
  online: boolean | null;
  page: {
    origin: string;
    pathname: string;
  };
  screen: {
    devicePixelRatio: number;
    height: number;
    viewportHeight: number;
    viewportWidth: number;
    width: number;
  };
  secureContext: boolean | null;
  userAgent: string;
}

interface BootStorageDiagnostics {
  cacheNames: string[] | null;
  persisted: boolean | null;
  quotaBytes: number | null;
  serviceWorkers: Array<{
    active: string | null;
    installing: string | null;
    scope: string;
    waiting: string | null;
  }> | null;
  usageBytes: number | null;
}

export interface BootDiagnosticsReport {
  collectedAt: string;
  currentAttempt: BootDiagnosticSnapshot;
  environment: BootEnvironmentDiagnostics;
  previousAttempt: unknown;
  storage: BootStorageDiagnostics;
}

const startedAtMs = Date.now();
const snapshot: BootDiagnosticSnapshot = {
  app: {
    commit: __APP_COMMIT_SHA__,
    version: __APP_VERSION__,
  },
  currentStage: "module-init",
  events: [],
  startedAt: new Date(startedAtMs).toISOString(),
};

const stripUrlPayload = (value: string): string => {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[redacted URL]";
  }
};

const redactDiagnosticText = (value: string): string =>
  value
    .replace(/https?:\/\/[^\s)]+/g, stripUrlPayload)
    .replace(
      /\b(?:nsec|ncryptsec)1[023456789acdefghjklmnpqrstuvwxyz]+\b/gi,
      "[redacted secret key]",
    )
    .replace(/\bcashu[ab][a-z0-9_-]{20,}\b/gi, "[redacted cashu token]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[redacted 32-byte value]");

const serializeError = (
  error: unknown,
  source: string,
  componentStack: string | null,
): BootDiagnosticError => ({
  componentStack:
    componentStack === null ? null : redactDiagnosticText(componentStack),
  message: redactDiagnosticText(
    getUnknownErrorMessage(error, "Unknown boot error"),
  ),
  name:
    error instanceof Error || error instanceof DOMException ? error.name : null,
  source,
  stack:
    error instanceof Error && error.stack
      ? redactDiagnosticText(error.stack)
      : null,
});

const persistSnapshot = (): void => {
  try {
    sessionStorage.setItem(
      CURRENT_BOOT_DIAGNOSTICS_KEY,
      JSON.stringify(snapshot),
    );
  } catch {
    // Diagnostics still remain available in memory.
  }
};

const appendEvent = (event: BootDiagnosticEvent): void => {
  snapshot.events.push(event);
  if (snapshot.events.length > MAX_BOOT_EVENTS) snapshot.events.shift();
  persistSnapshot();
};

const readPreviousAttempt = (): unknown => {
  try {
    const stored = sessionStorage.getItem(PREVIOUS_BOOT_DIAGNOSTICS_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    return parsed;
  } catch {
    return null;
  }
};

const collectEnvironmentDiagnostics = (): BootEnvironmentDiagnostics => ({
  displayModeStandalone:
    typeof matchMedia === "function" &&
    matchMedia("(display-mode: standalone)").matches,
  documentVisibility: document.visibilityState,
  features: {
    broadcastChannel: typeof BroadcastChannel !== "undefined",
    cacheStorage: typeof caches !== "undefined",
    indexedDb: typeof indexedDB !== "undefined",
    locks: Boolean(navigator.locks),
    opfs: typeof navigator.storage?.getDirectory === "function",
    serviceWorker: "serviceWorker" in navigator,
    worker: typeof Worker !== "undefined",
  },
  language: navigator.language,
  online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
  page: {
    origin: location.origin,
    pathname: location.pathname,
  },
  screen: {
    devicePixelRatio,
    height: screen.height,
    viewportHeight: innerHeight,
    viewportWidth: innerWidth,
    width: screen.width,
  },
  secureContext: typeof isSecureContext === "boolean" ? isSecureContext : null,
  userAgent: navigator.userAgent,
});

const runWithTimeout = async <T>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((resolve) => {
        timeoutId = globalThis.setTimeout(() => resolve(fallback), 1_000);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
  }
};

const collectStorageDiagnostics = async (): Promise<BootStorageDiagnostics> => {
  const estimate = navigator.storage?.estimate
    ? await runWithTimeout(() => navigator.storage.estimate(), {})
    : {};
  const persisted = navigator.storage?.persisted
    ? await runWithTimeout(() => navigator.storage.persisted(), null)
    : null;
  const cacheNames =
    typeof caches === "undefined"
      ? null
      : await runWithTimeout(() => caches.keys(), null);
  const registrations =
    "serviceWorker" in navigator
      ? await runWithTimeout(
          () => navigator.serviceWorker.getRegistrations(),
          null,
        )
      : null;

  return {
    cacheNames,
    persisted,
    quotaBytes: estimate.quota ?? null,
    serviceWorkers:
      registrations?.map((registration) => ({
        active: registration.active?.state ?? null,
        installing: registration.installing?.state ?? null,
        scope: registration.scope,
        waiting: registration.waiting?.state ?? null,
      })) ?? null,
    usageBytes: estimate.usage ?? null,
  };
};

export const recordBootStage = (stage: string): void => {
  snapshot.currentStage = stage;
  appendEvent({
    at: new Date().toISOString(),
    elapsedMs: Math.max(0, Date.now() - startedAtMs),
    error: null,
    kind: "stage",
    stage,
  });
};

export const recordBootError = (
  error: unknown,
  source: string,
  componentStack: string | null = null,
): void => {
  appendEvent({
    at: new Date().toISOString(),
    elapsedMs: Math.max(0, Date.now() - startedAtMs),
    error: serializeError(error, source, componentStack),
    kind: "error",
    stage: snapshot.currentStage,
  });
};

export const formatBootError = (error: unknown): string => {
  const serialized = serializeError(error, "display", null);
  return [serialized.message, serialized.stack]
    .filter((value): value is string => value !== null && value.length > 0)
    .join("\n\n");
};

export const getBootDiagnosticSnapshot = (): BootDiagnosticSnapshot => snapshot;

export const collectBootDiagnostics =
  async (): Promise<BootDiagnosticsReport> => ({
    collectedAt: new Date().toISOString(),
    currentAttempt: snapshot,
    environment: collectEnvironmentDiagnostics(),
    previousAttempt: readPreviousAttempt(),
    storage: await collectStorageDiagnostics(),
  });

export const downloadBootDiagnostics = async (): Promise<void> => {
  const report = await collectBootDiagnostics();
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `linky-boot-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

recordBootStage("module-loaded");
