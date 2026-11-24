export interface QrScannerProps {
  /** Called with each decoded text; returns whether it was what the scanner was looking for, which stops the camera. */
  readonly onScan: (text: string) => boolean;
  /** Names the camera picture for assistive tech. */
  readonly accessibilityLabel: string;
  /** Shown instead of the picture when the camera is unavailable or refused. */
  readonly unavailableLabel: string;
}

/** Camera streams are a web API; native apps scan with their camera module instead. */
export const QrScanner: (props: QrScannerProps) => null = () => null;
