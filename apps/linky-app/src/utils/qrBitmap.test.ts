import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrCodeBmp } from "./qrBitmap";

const HEADER_BYTES = 54;

/** RGBA pixels of a bottom-up 24-bit BMP. */
const decodeBmp = (bmp: Uint8Array) => {
  const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  const width = view.getInt32(18, true);
  const height = view.getInt32(22, true);
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = HEADER_BYTES + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const [b = 0, g = 0, r = 0] = bmp.subarray(row + x * 3, row + x * 3 + 3);
      rgba.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { height, rgba, width };
};

describe("qrCodeBmp", () => {
  it("encodes a BMP that a QR reader decodes back to the text", () => {
    const text = "SPD*1.0*ACC:CZ6508000000192000145399*AM:450.00*CC:CZK";
    const bmp = qrCodeBmp(text, { margin: 2, targetWidth: 300 });
    expect(new TextDecoder().decode(bmp.subarray(0, 2))).toBe("BM");
    const { height, rgba, width } = decodeBmp(bmp);
    expect(width).toBe(height);
    expect(width).toBeLessThanOrEqual(300);
    expect(jsQR(rgba, width, height)?.data).toBe(text);
  });
});
