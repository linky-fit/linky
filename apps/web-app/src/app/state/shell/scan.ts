import { ownerCommandsAtom } from "./ownerCommands";

export interface ScanCommands {
  readonly openScan: () => void;
  readonly openReceiveScan: () => void;
  readonly openWalletScan: () => void;
  readonly closeScan: () => void;
  readonly cycleScanCamera: () => void;
  readonly onPickScanImage: () => void;
  /** Handles clipboard text as if it had been scanned. */
  readonly pasteScanValue: () => Promise<void>;
  /** Handles typed text as if it had been scanned. */
  readonly handleScannedText: (text: string) => Promise<void>;
}

/** The scanner the shell mounts once, with the camera it runs. */
export const scanCommandsAtom = ownerCommandsAtom<ScanCommands>();
