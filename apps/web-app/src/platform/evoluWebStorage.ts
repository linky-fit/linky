const OPFS_PROBE_STALL_MS = 3_000;
const IN_MEMORY_SESSION_STORAGE_KEY = "linky.in_memory_session.v1";

export type OpfsProbeIssue = "unavailable" | "stalled";

interface PrepareEvoluWebStorageOptions {
  /**
   * Shows the temporary-session consent UI. The returned promise resolves
   * once the user opts into an in-memory session; it may never resolve when
   * the user keeps waiting instead — a stalled probe that later succeeds wins
   * the race and boot continues with persistent storage.
   */
  requestInMemoryConsent: (issue: OpfsProbeIssue) => Promise<void>;
}

let useInMemoryStorage = false;

const probeOpfs = async (): Promise<boolean> => {
  if (typeof navigator === "undefined") return true;
  try {
    const storage = navigator.storage;
    const getDirectory = storage?.getDirectory;
    if (!getDirectory) return false;
    await getDirectory.call(storage);
    return true;
  } catch {
    return false;
  }
};

const isInMemorySessionRemembered = (): boolean => {
  try {
    return sessionStorage.getItem(IN_MEMORY_SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const rememberInMemorySession = (): void => {
  try {
    sessionStorage.setItem(IN_MEMORY_SESSION_STORAGE_KEY, "1");
  } catch {
    // Without sessionStorage the choice only lasts until the next reload.
  }
};

export const prepareEvoluWebStorage = async (
  options: PrepareEvoluWebStorageOptions,
): Promise<void> => {
  useInMemoryStorage = isInMemorySessionRemembered();
  if (useInMemoryStorage) return;

  const probe = probeOpfs();

  let stallTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const issue = await Promise.race([
    probe.then((available): OpfsProbeIssue | null =>
      available ? null : "unavailable",
    ),
    new Promise<OpfsProbeIssue>((resolve) => {
      stallTimeoutId = globalThis.setTimeout(
        () => resolve("stalled"),
        OPFS_PROBE_STALL_MS,
      );
    }),
  ]);
  if (stallTimeoutId !== null) globalThis.clearTimeout(stallTimeoutId);
  if (issue === null) return;

  // A stalled probe may still succeed while the user reads the prompt; the
  // first outcome — explicit consent or late probe success — wins.
  const lateProbeSuccess = new Promise<boolean>((resolve) => {
    void probe.then((available) => {
      if (available) resolve(false);
    });
  });
  const consented = await Promise.race([
    options.requestInMemoryConsent(issue).then(() => true),
    lateProbeSuccess,
  ]);
  if (!consented) return;

  useInMemoryStorage = true;
  rememberInMemorySession();
};

export const shouldUseInMemoryEvoluStorage = (): boolean => useInMemoryStorage;
