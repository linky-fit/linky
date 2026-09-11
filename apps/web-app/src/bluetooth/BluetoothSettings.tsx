import { Bluetooth } from "lucide-react";
import { SettingsToggleRow } from "../components/SettingsRows";
import type { Translate } from "../i18n";
import { useBluetooth } from "./BluetoothContext";
import { bluetoothStatusKey } from "./status";

interface BluetoothSettingsProps {
  t: Translate;
}

export function BluetoothSettings({ t }: BluetoothSettingsProps) {
  const bluetooth = useBluetooth();
  if (!bluetooth.available) return null;
  return (
    <>
      <SettingsToggleRow
        icon={<Bluetooth size={18} />}
        label={t("bluetoothChat")}
        checked={bluetooth.enabled}
        disabled={bluetooth.busy}
        onChange={(enabled) => {
          void bluetooth.setEnabled(enabled);
        }}
      />
      <div className="bluetooth-settings-description">
        <p className="muted">{t("bluetoothDisclosure")}</p>
        <p role="status">{t(bluetoothStatusKey(bluetooth))}</p>
        {bluetooth.error && <p role="alert">{bluetooth.error}</p>}
      </div>
    </>
  );
}
