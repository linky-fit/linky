import { expect, type Page } from "@playwright/test";

/**
 * Console messages that indicate a real app fault. An allowlist, not zero
 * tolerance: Playwright reports every failed resource load, WebSocket
 * handshake and CORS rejection as a console "error", and the local stack
 * produces several of those by design (mint favicon probe, relay reconnects,
 * @evolu/common logging).
 */
const FATAL_CONSOLE_PATTERNS = [
  /^Boot failed at stage /,
  /^ErrorBoundary caught:/,
  /^\[linky\] post-mount/,
  /Maximum update depth exceeded/,
  /SQLiteError/,
];

/** Dynamic-import recovery reloads the page; that must never happen mid-test. */
const BOOT_RECOVERY_PATTERN =
  /\[linky\]\[boot\] retrying after dev dynamic import fetch failure/;

/**
 * Consequences of the test environment (blocked service workers, no camera in
 * headless Chromium), not app faults. Filtered out to keep the per-account
 * logs readable.
 */
const EXPECTED_NOISE = [
  /\[linky\]\[pwa\] sw register error/,
  /\[linky\]\[scan\] getUserMedia failed/,
];

export interface AppErrorWatcher {
  assertClean: () => void;
}

/**
 * Watch a page for genuine faults, and mirror the app's own [linky] logs into
 * the test output prefixed with the account label so three interleaved
 * contexts stay readable.
 */
export const watchAppErrors = (page: Page, label: string): AppErrorWatcher => {
  const failures: string[] = [];

  page.on("pageerror", (error) => {
    failures.push(`[${label}] pageerror: ${error.message}`);
  });

  page.on("console", (message) => {
    const text = message.text();

    const isExpectedNoise = EXPECTED_NOISE.some((pattern) =>
      pattern.test(text),
    );
    if (text.includes("[linky]") && !isExpectedNoise) {
      console.log(`[${label}] ${text}`);
    }

    if (BOOT_RECOVERY_PATTERN.test(text)) {
      failures.push(
        `[${label}] the app reloaded itself to recover from a failed dynamic ` +
          `import; the run is no longer trustworthy: ${text}`,
      );
      return;
    }

    if (message.type() !== "error") return;
    if (!FATAL_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) return;
    failures.push(`[${label}] console.error: ${text}`);
  });

  return {
    assertClean: () => {
      expect(failures, `app faults on ${label}`).toEqual([]);
    },
  };
};

/**
 * The panel is the only signal for pre-mount unhandled rejections and the
 * "Boot stuck after 15s" watchdog — neither logs "Boot failed at stage".
 */
export const expectNoBootErrorPanel = async (
  page: Page,
  label: string,
): Promise<void> => {
  await expect(
    page.getByRole("heading", { name: "Boot error" }),
    `[${label}] the app rendered its boot-error panel`,
  ).toHaveCount(0);
};
