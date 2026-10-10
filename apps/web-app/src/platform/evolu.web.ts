import { createSharedWebWorker, evoluWebDeps } from "@evolu/web";
import { flushSync } from "react-dom";
import { safeLocalStorageGet } from "../utils/storage";
import { shouldUseInMemoryEvoluStorage } from "./evoluWebStorage";
import type { EvoluPlatform } from "./ports";

// SQL logging is very noisy, so dev builds log only on request:
// localStorage.setItem('linky_debug_evolu_sql', '1')
const isEvoluLoggingEnabled = (): boolean =>
  import.meta.env.DEV && safeLocalStorageGet("linky_debug_evolu_sql") === "1";

/** Read after `prepareEvoluWebStorage`, which decides whether this session runs in memory. */
export const makeWebEvoluPlatform = (): EvoluPlatform => ({
  evoluDeps: { ...evoluWebDeps, flushSync },
  createWorker: (name) =>
    createSharedWebWorker(
      name,
      () =>
        new Worker(new URL("../evoluDb.worker.ts", import.meta.url), {
          type: "module",
        }),
    ),
  inMemory: shouldUseInMemoryEvoluStorage(),
  enableLogging: isEvoluLoggingEnabled(),
});
