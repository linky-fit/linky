import { describe, expect, it } from "vitest";
import { palettes, radius, size, space, zIndex } from "./tokens";

type Rgb = readonly number[];

const channels = (color: string) =>
  [1, 3, 5, 7].map(
    (offset) =>
      Number.parseInt(color.slice(offset, offset + 2) || "ff", 16) / 255,
  );

/** Flattens a possibly translucent hex color onto an opaque backdrop. */
const over = (color: string, backdrop: Rgb): Rgb => {
  const [r = 0, g = 0, b = 0, a = 1] = channels(color);
  return [r, g, b].map(
    (channel, index) => channel * a + (backdrop[index] ?? 0) * (1 - a),
  );
};

const luminance = (rgb: Rgb) => {
  const [r = 0, g = 0, b = 0] = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (foreground: string, background: string, page: string) => {
  const fill = over(background, channels(page));
  const [light = 0, dark = 0] = [
    luminance(over(foreground, fill)),
    luminance(fill),
  ].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

const variants = Object.entries(palettes).flatMap(([palette, modes]) =>
  Object.entries(modes).map(([mode, theme]) => ({
    name: `${palette} ${mode}`,
    theme,
  })),
);

describe("palettes", () => {
  it.each(variants)("$name has the default dark keys", ({ theme }) => {
    expect(Object.keys(theme).sort()).toEqual(
      Object.keys(palettes.default.dark).sort(),
    );
  });

  // A `$key` resolves to the theme before the prop's token group, so a shared name hides the token.
  it.each(Object.entries({ space, size, radius, zIndex }))(
    "share no key with the %s tokens",
    (_group, tokens) => {
      const shared = Object.keys(tokens).filter(
        (key) => key in palettes.default.dark,
      );
      expect(shared).toEqual([]);
    },
  );

  it.each(variants)("$name uses only hex colors", ({ theme }) => {
    for (const value of Object.values(theme)) {
      expect(value).toMatch(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/);
    }
  });
});

describe.each(variants)("$name text contrast", ({ theme }) => {
  it.each([
    ["body on page", theme.color, theme.background],
    ["body on surface", theme.color, theme.surface],
    ["body on raised surface", theme.color, theme.surfaceRaised],
    ["subtle on surface", theme.colorSubtle, theme.surface],
    ["muted on page", theme.colorMuted, theme.background],
    ["muted on surface", theme.colorMuted, theme.surface],
    ["primary action", theme.onAccent, theme.accent],
    ["primary action pressed", theme.onAccent, theme.accentPress],
    ["danger action", theme.onDanger, theme.danger],
    ["accent text on accent soft", theme.accentText, theme.accentSoft],
    ["danger text on danger soft", theme.dangerText, theme.dangerSoft],
    ["warning text on warning soft", theme.warningText, theme.warningSoft],
    ["info text on info soft", theme.infoText, theme.infoSoft],
    ["body on incoming message", theme.color, theme.neutralSoft],
    ["body on outgoing message", theme.color, theme.accentSoft],
  ])("keeps %s readable (WCAG AA)", (_name, foreground, background) => {
    expect(
      contrast(foreground, background, theme.background),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
