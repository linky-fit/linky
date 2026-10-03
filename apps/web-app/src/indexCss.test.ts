import {
  COLOR_MODES,
  palettes,
  THEME_PALETTES,
  type ColorMode,
  type ThemePalette,
} from "@linky-fit/ui/tokens";
import { describe, expect, it } from "vitest";
import css from "./index.css?raw";

const selector = (palette: ThemePalette, mode: ColorMode): string => {
  const theme = palette === "default" ? "" : `[data-theme="${palette}"]`;
  const colorMode = mode === "light" ? '[data-color-mode="light"]' : "";
  return `:root${theme}${colorMode}`;
};

const ruleBody = (ruleSelector: string): string => {
  const start = css.indexOf(`\n${ruleSelector} {`);
  expect(start, ruleSelector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};

describe("index.css", () => {
  it.each(
    THEME_PALETTES.flatMap((palette) =>
      COLOR_MODES.map((mode): [ThemePalette, ColorMode] => [palette, mode]),
    ),
  )(
    "repeats the %s %s colors it paints before the JS bundle loads",
    (palette, mode) => {
      const body = ruleBody(selector(palette, mode));
      const colors = palettes[palette][mode];
      expect(body).toContain(`--app-flat-bg: ${colors.background};`);
      expect(body).toContain(`--app-color: ${colors.color};`);
      expect(body).toContain(`--app-accent: ${colors.accent};`);
    },
  );
});
