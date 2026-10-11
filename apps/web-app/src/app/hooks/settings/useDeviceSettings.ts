import {
  RegistryContext,
  useAtom,
  useAtomSet,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import type { Lang } from "../../../i18n";
import { requestDeviceMotionPermission } from "../../../platform/deviceMotion";
import type { DisplayCurrency } from "../../../utils/displayAmounts";
import { nowSeconds } from "../../../utils/time";
import {
  motionPermissionPendingAtom,
  seenReceiptsEnabledAtSecAtom,
  showProfileQrOnTiltAtom,
} from "../../state/shell/devicePrefs";
import {
  allowedDisplayCurrenciesAtom,
  displayPrefsAtom,
} from "../../state/shell/displayPrefs";
import { useAllowedDisplayCurrencies } from "../useAllowedDisplayCurrencies";

export const useSetLang = () => {
  const setPrefs = useAtomSet(displayPrefsAtom);
  return React.useCallback(
    (lang: Lang) => setPrefs((prefs) => ({ ...prefs, lang })),
    [setPrefs],
  );
};

/** The display currency, the currencies Settings enables and the keypad's decimal input. */
export const useDisplaySettings = () => {
  const [{ decimalAmountInputEnabled, displayCurrency }, setPrefs] =
    useAtom(displayPrefsAtom);
  const allowed = useAllowedDisplayCurrencies();
  const allowedDisplayCurrencies = allowed.allowedDisplayCurrencies;
  const setDisplayCurrency = React.useCallback(
    (currency: DisplayCurrency) => {
      if (!allowedDisplayCurrencies.includes(currency)) return;
      setPrefs((prefs) => ({ ...prefs, displayCurrency: currency }));
    },
    [allowedDisplayCurrencies, setPrefs],
  );
  const toggleDecimalAmountInput = React.useCallback(
    () =>
      setPrefs((prefs) => ({
        ...prefs,
        decimalAmountInputEnabled: !prefs.decimalAmountInputEnabled,
      })),
    [setPrefs],
  );
  return {
    ...allowed,
    decimalAmountInputEnabled,
    displayCurrency,
    setDisplayCurrency,
    toggleDecimalAmountInput,
  };
};

/**
 * Keeps the display currency among the enabled ones when Settings or another
 * device disables it. Mounted once by the shell.
 */
export const useDisplayCurrencyGuard = (): void => {
  const allowedDisplayCurrencies = useAtomValue(allowedDisplayCurrenciesAtom);
  const [{ displayCurrency }, setPrefs] = useAtom(displayPrefsAtom);
  React.useEffect(() => {
    if (allowedDisplayCurrencies.includes(displayCurrency)) return;
    setPrefs((prefs) => ({
      ...prefs,
      displayCurrency: allowedDisplayCurrencies[0] ?? "sat",
    }));
  }, [allowedDisplayCurrencies, displayCurrency, setPrefs]);
};

export const useSeenReceiptsSetting = () => {
  const [enabledAtSec, setEnabledAtSec] = useAtom(seenReceiptsEnabledAtSecAtom);
  // Enabling records the baseline: only messages newer than it are ever
  // reported as seen, so pre-enable history stays unreported.
  const toggleSendReadReceipts = React.useCallback(
    () =>
      setEnabledAtSec((current) => (current === null ? nowSeconds() : null)),
    [setEnabledAtSec],
  );
  return {
    sendReadReceiptsEnabled: enabledAtSec !== null,
    toggleSendReadReceipts,
  };
};

export const useTiltSetting = () => {
  const registry = React.useContext(RegistryContext);
  const [showProfileQrOnTiltEnabled, setEnabled] = useAtom(
    showProfileQrOnTiltAtom,
  );
  const toggleShowProfileQrOnTilt = React.useCallback(async () => {
    if (registry.get(motionPermissionPendingAtom)) return;
    registry.set(motionPermissionPendingAtom, true);
    const enabled = showProfileQrOnTiltEnabled
      ? false
      : await requestDeviceMotionPermission();
    setEnabled(enabled);
    registry.set(motionPermissionPendingAtom, false);
    reportAppLog({
      tag: "profileShare.tiltSettingChanged",
      summary: enabled
        ? "Tilt to show profile enabled"
        : "Tilt to show profile disabled",
      payload: {
        enabled,
        permissionGranted: showProfileQrOnTiltEnabled ? null : enabled,
      },
    });
  }, [registry, setEnabled, showProfileQrOnTiltEnabled]);
  return { showProfileQrOnTiltEnabled, toggleShowProfileQrOnTilt };
};
