import { test as base, type BrowserContext } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { inspectorLogs } from "./linkyHooks";

export { expect } from "@playwright/test";

const READ_TIMEOUT_MS = 5_000;

const enableInspectorLogs = (context: BrowserContext): Promise<void> =>
  context.addInitScript(() =>
    localStorage.setItem("linky.inspector_logs_enabled", "true"),
  );

/** The context's inspector log from the first page that answers; contexts share it per origin. */
const readInspectorLogs = async (
  context: BrowserContext,
): Promise<string | null> => {
  for (const page of context.pages()) {
    const logs = await Promise.race([
      inspectorLogs(page).catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(resolve, READ_TIMEOUT_MS, null),
      ),
    ]);
    if (logs) return logs;
  }
  return null;
};

/**
 * Every spec imports `test` from here. Each browser context the test opens
 * keeps the app's persistent inspector log, read just before the context
 * closes because the log lives in its IndexedDB. A failed test gets one
 * ndjson attachment per context, importable into the inspector viewer.
 */
export const test = base.extend<{ inspectorLogsOnFailure: void }>({
  inspectorLogsOnFailure: [
    async ({ browser }, use, testInfo) => {
      const logs: string[] = [];
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (options) => {
        const context = await newContext(options);
        await enableInspectorLogs(context);
        const close = context.close.bind(context);
        context.close = async (closeOptions) => {
          const read = await readInspectorLogs(context);
          if (read) logs.push(read);
          await close(closeOptions);
        };
        return context;
      };
      await use();
      browser.newContext = newContext;
      for (const context of browser.contexts()) {
        const read = await readInspectorLogs(context);
        if (read) logs.push(read);
      }
      if (testInfo.status === testInfo.expectedStatus) return;
      for (const [index, body] of logs.entries()) {
        const path = testInfo.outputPath(`inspector-${index + 1}.ndjson`);
        await writeFile(path, body);
        await testInfo.attach(`inspector-${index + 1}.ndjson`, {
          path,
          contentType: "application/x-ndjson",
        });
      }
    },
    { auto: true },
  ],
});
