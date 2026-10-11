import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { navigateTo, useRouting } from "../../../hooks/useRouting";
import {
  scanCameraDevicesAtom,
  scanCommandsAtom,
  scanDiagnosticsAtom,
  scanEntryPointAtom,
  scanIsOpenAtom,
  scanVideoRefAtom,
} from "../../state/shell/scan";
import { useOpenNewContactPage } from "../contacts/useContactActions";

/** Opens the scanner from any screen; the shell runs the camera. */
export const useScanCommands = () => {
  const commands = useAtomValue(scanCommandsAtom);
  return React.useMemo(
    () => ({
      closeScan: () => commands?.read().closeScan(),
      cycleScanCamera: () => commands?.read().cycleScanCamera(),
      handleScannedText: async (text: string) =>
        commands?.read().handleScannedText(text),
      onPickScanImage: () => commands?.read().onPickScanImage(),
      openReceiveScan: () => commands?.read().openReceiveScan(),
      openScan: () => commands?.read().openScan(),
      openWalletScan: () => commands?.read().openWalletScan(),
      pasteScanValue: async () => commands?.read().pasteScanValue(),
    }),
    [commands],
  );
};

export const useScanIsOpen = () => useAtomValue(scanIsOpenAtom);

/** What the open scanner shows: where it was opened from, the camera and its reads. */
export const useScanView = () => {
  const scanEntryPoint = useAtomValue(scanEntryPointAtom);
  return {
    scanAllowsManualContact: scanEntryPoint === "contacts",
    scanCanSwitchCamera: useAtomValue(scanCameraDevicesAtom).length > 1,
    scanDiagnostics: useAtomValue(scanDiagnosticsAtom),
    scanEntryPoint,
    scanVideoRef: useAtomValue(scanVideoRefAtom),
  };
};

/** The scan sheet's ways out: type a contact, a payment, or issue a token instead. */
export const useScanShortcuts = () => {
  const { closeScan } = useScanCommands();
  const route = useRouting();
  const openNewContactPage = useOpenNewContactPage();
  return {
    openIssueTokenFromScan: () => {
      closeScan();
      if (route.kind === "cashuTokenEmit") return;
      navigateTo({ route: "cashuTokenEmit" });
    },
    openManualContactFromScan: () => {
      closeScan();
      if (route.kind === "contactNew") return;
      openNewContactPage();
    },
    openManualPayFromScan: () => {
      closeScan();
      if (route.kind === "manualPay") return;
      navigateTo({ route: "manualPay" });
    },
  };
};
