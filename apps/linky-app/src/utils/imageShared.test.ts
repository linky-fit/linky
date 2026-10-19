import { describe, expect, it } from "vitest";
import { avatarCropSquare } from "./imageShared";

describe("avatarCropSquare", () => {
  it("takes the centred square of the shorter side", () => {
    expect(avatarCropSquare(400, 200)).toEqual({ side: 200, x: 100, y: 0 });
  });

  it("zooms around the crop centre and keeps the square inside the image", () => {
    expect(
      avatarCropSquare(400, 200, { centerX: 390, centerY: 10, zoom: 2 }),
    ).toEqual({ side: 100, x: 300, y: 0 });
  });

  it("never zooms out past the image", () => {
    expect(
      avatarCropSquare(300, 300, { centerX: 150, centerY: 150, zoom: 0.5 }),
    ).toEqual({ side: 300, x: 0, y: 0 });
  });
});
