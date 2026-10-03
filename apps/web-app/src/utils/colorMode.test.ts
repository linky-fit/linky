import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadColorMode = async () => {
  vi.resetModules();
  return import("./colorMode");
};

const stubSystemPrefersLight = (matches: boolean) => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query): MediaQueryList => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  );
};

describe("colorMode", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("follows the system by default", async () => {
    stubSystemPrefersLight(true);
    const colorMode = await loadColorMode();

    expect(colorMode.getColorModePreference()).toBe("auto");
    expect(colorMode.getColorMode()).toBe("light");
  });

  it("stores an explicit choice that overrides the system and notifies subscribers", async () => {
    stubSystemPrefersLight(true);
    const colorMode = await loadColorMode();
    const listener = vi.fn();
    const unsubscribe = colorMode.subscribeColorMode(listener);

    colorMode.setColorModePreference("dark");
    unsubscribe();

    expect(colorMode.getColorMode()).toBe("dark");
    expect(listener).toHaveBeenCalledOnce();
    expect((await loadColorMode()).getColorModePreference()).toBe("dark");
  });

  it("paints the document and browser chrome with the theme background", async () => {
    const { applyColorModeToDocument } = await loadColorMode();
    const { palettes } = await import("@linky-fit/ui/tokens");
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);

    applyColorModeToDocument("light");

    expect(document.documentElement.dataset.colorMode).toBe("light");
    expect(meta.content).toBe(palettes.default.light.background);
    meta.remove();
  });
});
