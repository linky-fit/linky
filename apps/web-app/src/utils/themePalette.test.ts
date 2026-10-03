import { palettes } from "@linky-fit/ui/tokens";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadThemePalette = async () => {
  vi.resetModules();
  return import("./themePalette");
};

describe("themePalette", () => {
  beforeEach(() => localStorage.clear());

  it("starts on Default and ignores an unknown stored palette", async () => {
    localStorage.setItem("linky.theme", "neon");
    const theme = await loadThemePalette();

    expect(theme.getThemePalettePreference()).toBe("default");
    expect(theme.getThemePalette()).toBe("default");
  });

  it("stores the choice under linky.theme and notifies subscribers", async () => {
    const theme = await loadThemePalette();
    const listener = vi.fn();
    const unsubscribe = theme.subscribeThemePalette(listener);

    theme.setThemePalettePreference("gold");
    unsubscribe();

    expect(listener).toHaveBeenCalledOnce();
    expect(localStorage.getItem("linky.theme")).toBe("gold");
    expect((await loadThemePalette()).getThemePalettePreference()).toBe("gold");
  });

  it("trusts the preference until the awards are read", async () => {
    localStorage.setItem("linky.theme", "gold");
    const theme = await loadThemePalette();

    expect(theme.getThemePalette()).toBe("gold");
  });

  it("renders Default while locked and keeps the preference for a renewal", async () => {
    localStorage.setItem("linky.theme", "gold");
    const theme = await loadThemePalette();

    theme.setUnlockedSupporterTier("silver");
    expect(theme.getThemePalette()).toBe("default");
    expect(theme.getThemePalettePreference()).toBe("gold");

    theme.setUnlockedSupporterTier("diamond");
    expect(theme.getThemePalette()).toBe("gold");
  });

  it("unlocks a palette with its own tier or a higher one", async () => {
    const { isPaletteUnlocked } = await loadThemePalette();

    expect(isPaletteUnlocked("default", null)).toBe(true);
    expect(isPaletteUnlocked("bronze", null)).toBe(false);
    expect(isPaletteUnlocked("silver", "bronze")).toBe(false);
    expect(isPaletteUnlocked("silver", "silver")).toBe(true);
    expect(isPaletteUnlocked("silver", "diamond")).toBe(true);
  });

  it("paints the document and browser chrome with the theme background", async () => {
    const { applyAppearanceToDocument } = await loadThemePalette();
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);

    applyAppearanceToDocument("light", "gold");

    expect(document.documentElement.dataset.colorMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("gold");
    expect(meta.content).toBe(palettes.gold.light.background);
    meta.remove();
  });
});
