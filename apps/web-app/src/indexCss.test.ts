import { themes } from "@linky-fit/ui/tokens";
import { describe, expect, it } from "vitest";
import css from "./index.css?raw";

const lightBlock = css.slice(css.indexOf(':root[data-color-mode="light"]'));

describe("index.css", () => {
  it("repeats the dark theme colors it paints before the JS bundle loads", () => {
    expect(css).toContain(`--app-flat-bg: ${themes.dark.background};`);
    expect(css).toContain(`--app-color: ${themes.dark.color};`);
    expect(css).toContain(`--app-accent: ${themes.dark.accent};`);
  });

  it("repeats the light theme colors under the light color mode", () => {
    expect(lightBlock).toContain(`--app-flat-bg: ${themes.light.background};`);
    expect(lightBlock).toContain(`--app-color: ${themes.light.color};`);
    expect(lightBlock).toContain(`--app-accent: ${themes.light.accent};`);
  });
});
