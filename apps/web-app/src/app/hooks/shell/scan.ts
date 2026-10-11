import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { scanCommandsAtom } from "../../state/shell/scan";

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
