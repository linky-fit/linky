import { currentRoutePath } from "./navigation";
import { restartAppAt } from "./restartApp.native";

/** Restarts the app from its entry point on the route it shows, as a page reload does. */
export const reloadApp = (): void => restartAppAt(currentRoutePath());
