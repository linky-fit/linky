import { describe, expect, it } from "vitest";
import { themes, palette, radius, space, size } from "./tokens";

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
describe("the extracted Linky identity", () => {
  it("preserves the approved demo colors and dimensions", () => {
    expect(themes.dark.background).toBe("#020617");
    expect(themes.dark.accent).toBe("#2dd4bf");
    expect(themes.light.accent).toBe(palette.teal700);
    expect(radius.control).toBe(12);
    expect(radius.card).toBe(16);
    expect(space.page).toBe(20);
    expect(size.touch).toBeGreaterThanOrEqual(44);
  });
  it("provides the same semantic roles in both themes", () => {
    expect(Object.keys(themes.light).sort()).toEqual(
      Object.keys(themes.dark).sort(),
    );
  });
  for (const [name, theme] of Object.entries(themes)) {
    it(`${name} keeps component text readable on its actual backgrounds`, () => {
      const pairs = [
        [theme.color, theme.background],
        [theme.muted, theme.surface],
        [theme.color, theme.incoming],
        [theme.color, theme.outgoing],
        [theme.accent, theme.outgoing],
        [theme.onAccent, theme.accent],
        [theme.danger, theme.dangerSoft],
        [theme.warning, theme.warningSoft],
        [theme.success, theme.successSoft],
        [theme.info, theme.infoSoft],
      ];
      for (const [foreground, background] of pairs)
        expect(contrast(foreground!, background!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
