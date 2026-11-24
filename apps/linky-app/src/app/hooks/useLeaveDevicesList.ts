import { RegistryContext } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { getUnknownErrorMessage } from "../../utils/unknown";
import { readThisDevice } from "../lib/thisDevice";
import { devicesRepositoryAtom, readLinkyStore } from "../state/session/store";

// The user waits on a logout, which already warns when the device is offline.
const LOGOUT_UPLOAD_WAIT = "3 seconds";

/**
 * Takes this device off the devices list before a logout wipes it, waiting a
 * moment for a relay to take that and the device's other changes.
 */
export const useLeaveDevicesList = (): (() => Promise<void>) => {
  const registry = React.useContext(RegistryContext);
  return React.useCallback(async () => {
    try {
      const [store, devices] = await Promise.all([
        readLinkyStore(registry),
        Effect.runPromise(
          AtomRegistry.getResult(registry, devicesRepositoryAtom),
        ),
      ]);
      await Effect.runPromise(devices.leave(readThisDevice().id));
      const uploaded = await Effect.runPromise(
        Effect.timeoutOption(store.whenUploaded, LOGOUT_UPLOAD_WAIT),
      );
      reportAppLog({
        tag: "devices.left",
        summary:
          "This device took itself off the devices list before logging out",
        payload: { uploaded: uploaded._tag === "Some" },
      });
    } catch (error) {
      reportAppLog({
        tag: "devices.leaveFailed",
        summary: "This device could not take itself off the devices list",
        payload: { error: getUnknownErrorMessage(error, "unknown") },
      });
    }
  }, [registry]);
};
