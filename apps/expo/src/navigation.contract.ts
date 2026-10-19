import type * as viteNavigation from "@linky-fit/linky-app/src/platform/navigation";
import * as expoNavigation from "./navigation";

// Fails to typecheck when the two modules export different names or types.
export const navigationContract: typeof viteNavigation = expoNavigation;
