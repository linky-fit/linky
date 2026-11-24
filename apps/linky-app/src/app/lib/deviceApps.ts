import type { LinkedDeviceRecord } from "@linky-fit/linksync";

const APP_NAMES: Readonly<Record<string, string>> = {
  linky: "Linky",
  fazole: "Fazole",
  finito: "Finito",
};

/** The app a device row names; an app this release does not know shows as written. */
export const deviceAppName = (app: string): string => APP_NAMES[app] ?? app;

/** How a removed device names the one that removed it, e.g. "MacBook (Fazole)". */
export const removerLabel = (device: LinkedDeviceRecord): string =>
  `${device.name} (${deviceAppName(device.app)})`;
