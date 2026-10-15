import { Atom } from "effect/reactivity";
import { ownerCommandsAtom } from "./ownerCommands";

export type ScanEntryPoint = "contacts" | "receive" | "send";

/** What the scanner has collected of the animation it is reading. */
export interface AnimatedQrScanState {
  received: number;
  expected: number | null;
}

/**
 * What the camera is actually reading, shown while scanning. A scan that goes
 * nowhere is otherwise indistinguishable from a camera decoding nothing, and
 * the difference decides where to look.
 */
export interface ScanDiagnostics {
  /** QR values decoded since the scanner opened. */
  reads: number;
  /** Why the last animation frame was refused, when one was. */
  lastRejection: string;
  /** Start of the most recent decoded value. */
  lastValue: string;
  animation: AnimatedQrScanState | null;
}

export const SCAN_DIAGNOSTICS_START: ScanDiagnostics = {
  animation: null,
  lastRejection: "",
  lastValue: "",
  reads: 0,
};

export const scanIsOpenAtom = Atom.keepAlive(Atom.make(false));

/** Where the open scanner was started from, which decides what it accepts. */
export const scanEntryPointAtom = Atom.keepAlive(
  Atom.make<ScanEntryPoint | null>(null),
);

export const scanDiagnosticsAtom = Atom.keepAlive(
  Atom.make<ScanDiagnostics>(SCAN_DIAGNOSTICS_START),
);

/** The cameras the open scanner can switch between. */
export const scanCameraDevicesAtom = Atom.keepAlive(
  Atom.make<readonly MediaDeviceInfo[]>([]),
);

const makeVideoRef = (): { current: HTMLVideoElement | null } => ({
  current: null,
});

/** The scanner's preview element, rendered by the scan sheet and read by the camera loop. */
export const scanVideoRefAtom = Atom.keepAlive(Atom.readable(makeVideoRef));

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
