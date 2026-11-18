import { createConsole } from "@evolu/common";
import { createEvoluDeps, createRun } from "@evolu/web";
import { safeLocalStorageGet } from "../utils/storage";
import { isDevBuild } from "./buildEnv";

// SQL logging is very noisy, so dev builds log only on request:
// localStorage.setItem('linky_debug_evolu_sql', '1')
const isEvoluLoggingEnabled = (): boolean =>
  isDevBuild && safeLocalStorageGet("linky_debug_evolu_sql") === "1";

/** The page's one Evolu run; creating it starts Evolu's shared worker. */
export const createEvoluRun = () =>
  createRun(
    createEvoluDeps(
      isEvoluLoggingEnabled()
        ? { console: createConsole({ level: "debug" }) }
        : {},
    ),
  );
