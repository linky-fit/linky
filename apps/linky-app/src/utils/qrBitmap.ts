import QRCode from "qrcode";

interface QrModules {
  size: number;
  data: Uint8Array;
}

const BMP_HEADER_BYTES = 54;

/**
 * A black-on-white QR code of `text` as an uncompressed 24-bit BMP, which
 * every platform image decoder reads without a canvas.
 */
export const qrCodeBmp = (
  text: string,
  { margin, targetWidth }: { margin: number; targetWidth: number },
): Uint8Array => {
  const { modules }: { modules: QrModules } = QRCode.create(text, {
    errorCorrectionLevel: "M",
  });
  const sideModules = modules.size + margin * 2;
  const scale = Math.max(1, Math.floor(targetWidth / sideModules));
  const side = sideModules * scale;
  const rowBytes = Math.ceil((side * 3) / 4) * 4;
  const bytes = new Uint8Array(BMP_HEADER_BYTES + rowBytes * side);
  const view = new DataView(bytes.buffer);
  bytes.set([0x42, 0x4d]);
  view.setUint32(2, bytes.byteLength, true);
  view.setUint32(10, BMP_HEADER_BYTES, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, side, true);
  view.setInt32(22, side, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, rowBytes * side, true);

  const isDark = (x: number, y: number): boolean => {
    const column = Math.floor(x / scale) - margin;
    const row = Math.floor(y / scale) - margin;
    return (
      column >= 0 &&
      row >= 0 &&
      column < modules.size &&
      row < modules.size &&
      modules.data[row * modules.size + column] === 1
    );
  };
  for (let y = 0; y < side; y += 1) {
    // BMP rows run bottom-up.
    const rowStart = BMP_HEADER_BYTES + (side - 1 - y) * rowBytes;
    for (let x = 0; x < side; x += 1) {
      const value = isDark(x, y) ? 0 : 255;
      bytes.fill(value, rowStart + x * 3, rowStart + x * 3 + 3);
    }
  }
  return bytes;
};
