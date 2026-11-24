import { describeDevice, type DevicesRepository } from "@linky-fit/linksync";
import { useHydrated } from "@linky-fit/linksync/react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import React from "react";
import { reportAppLog } from "../devtools/inspector/appLog";
import { clearIdentitySecrets } from "../platform/identitySecrets";
import { markLogoutPending } from "../platform/logoutWipe";
import { getUserAgent } from "../platform/runtime";
import { getUnknownErrorMessage } from "../utils/unknown";
import { useDevicesRepository, useLinkyStore } from "./hooks/useLinksync";
import { stopBeaconForIdentityChange } from "./lib/beaconStore";
import { removerLabel } from "./lib/deviceApps";
import { markThisDeviceJoined, readThisDevice } from "./lib/thisDevice";
import { platformAtom } from "./state/platform";

/** Another device removed this one: wipe it like a logout, and onboarding says who did. */
const signOutRemovedDevice = async (
  devices: DevicesRepository,
  reload: () => void,
): Promise<void> => {
  const removal = await Effect.runPromise(devices.removal(readThisDevice().id));
  const removedBy = removal?.by == null ? null : removerLabel(removal.by);
  reportAppLog({
    tag: "devices.removedHere",
    summary:
      "Another device removed this one; every tab reloads to erase this device's data",
    payload: { removedBy: removal?.by?.id ?? null },
  });
  stopBeaconForIdentityChange();
  await clearIdentitySecrets();
  markLogoutPending({ removedBy });
  reload();
};

const register = async (
  devices: DevicesRepository,
  signOut: () => void,
): Promise<void> => {
  const device = readThisDevice();
  const labels = describeDevice(getUserAgent());
  const outcome = await Effect.runPromise(
    devices.register({
      id: device.id,
      app: "linky",
      name: labels.name ?? "Linky",
      deviceType: labels.deviceType,
      browserName: labels.browserName,
      osName: labels.osName,
      joining: !device.joined,
    }),
  );
  if (outcome === "removed") {
    signOut();
    return;
  }
  if (!device.joined) {
    markThisDeviceJoined(device.id);
    reportAppLog({
      tag: "devices.joined",
      summary: "This device added itself to the recovery seed's devices",
      payload: { deviceId: device.id, name: labels.name },
    });
  }
};

/**
 * Keeps this device's row in the devices list once the local data is read,
 * and signs the device out when another device removes it, at start or while
 * it runs.
 */
export const DevicesController = (): null => {
  const devices = useDevicesRepository();
  const hydrated = useHydrated(useLinkyStore());
  const { reload } = useAtomValue(platformAtom).lifecycle;
  const signingOut = React.useRef(false);

  React.useEffect(() => {
    if (!hydrated) return;
    let registered = false;
    const signOut = () => {
      if (signingOut.current) return;
      signingOut.current = true;
      void signOutRemovedDevice(devices, reload);
    };
    void register(devices, signOut).then(
      () => {
        registered = true;
      },
      (error: unknown) => {
        reportAppLog({
          tag: "devices.registerFailed",
          summary: "This device could not write its row in the devices list",
          payload: { error: getUnknownErrorMessage(error, "unknown") },
        });
      },
    );
    return devices.subscribe(() => {
      if (!registered) return;
      const { id } = readThisDevice();
      void Effect.runPromise(devices.removal(id)).then((removal) => {
        if (removal !== null) signOut();
      });
    });
  }, [devices, hydrated, reload]);

  return null;
};
