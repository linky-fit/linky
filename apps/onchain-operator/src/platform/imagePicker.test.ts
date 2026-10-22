import { describe, expect, it } from "vitest";
import { cropSquare } from "./imagePicker";

describe("a square crop", () => {
  it("takes the largest centered square at zoom 1", () => {
    expect(
      cropSquare(400, 300, { center: { x: 200, y: 150 }, zoom: 1 }),
    ).toEqual({ x: 50, y: 0, side: 300 });
  });

  it("shrinks with zoom and stays inside the image", () => {
    expect(cropSquare(400, 300, { center: { x: 0, y: 300 }, zoom: 2 })).toEqual(
      { x: 0, y: 150, side: 150 },
    );
  });
});
