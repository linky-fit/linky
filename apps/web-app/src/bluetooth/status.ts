import type { I18nKey } from "../i18n";
import type { BluetoothSnapshot } from "./controller";

export const bluetoothStatusKey = ({
  enabled,
  state,
}: Pick<BluetoothSnapshot, "enabled" | "state">): I18nKey => {
  if (!state.supported) return "bluetoothUnsupported";
  if (state.permission === "denied") return "bluetoothPermissionDenied";
  if (!enabled) return "bluetoothOff";
  if (!state.powered) return "bluetoothRadioOff";
  if (!state.active) return "bluetoothPaused";
  return "bluetoothActive";
};
