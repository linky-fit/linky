import type { ReactNode } from "react";
import type { Device } from "./device";
import { DeviceContext } from "./react";

export function DeviceProvider({
  device,
  children,
}: {
  readonly device: Device;
  readonly children: ReactNode;
}) {
  return <DeviceContext value={device}>{children}</DeviceContext>;
}
