import { palettes } from "@linky-fit/ui/tokens";
import { describe, expect, it } from "vitest";
import css from "./index.css?raw";

const { dark, light } = palettes.default;

const lightBlock = css.slice(css.indexOf(':root[data-color-mode="light"]'));

describe("index.css", () => {
  it("repeats the dark theme colors it paints before the JS bundle loads", () => {
    expect(css).toContain(`--app-flat-bg: ${dark.background};`);
    expect(css).toContain(`--app-color: ${dark.color};`);
    expect(css).toContain(`--app-accent: ${dark.accent};`);
  });

  it("repeats the light theme colors under the light color mode", () => {
    expect(lightBlock).toContain(`--app-flat-bg: ${light.background};`);
    expect(lightBlock).toContain(`--app-color: ${light.color};`);
    expect(lightBlock).toContain(`--app-accent: ${light.accent};`);
  });
});
