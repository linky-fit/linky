import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERIC_MINT_ICON_DATA_URL,
  getNextMintIconUrl,
  isHiddenTestMint,
  isTestMintUrl,
} from "./mint";

describe("getNextMintIconUrl", () => {
  it("falls back to favicon before the generic placeholder", () => {
    expect(
      getNextMintIconUrl(
        "https://cdn.example/icon.png",
        "https://cashu.example",
      ),
    ).toBe("https://cashu.example/favicon.ico");
  });

  it("falls back to the generic placeholder after favicon fails", () => {
    expect(
      getNextMintIconUrl(
        "https://cashu.example/favicon.ico",
        "https://cashu.example",
      ),
    ).toBe(GENERIC_MINT_ICON_DATA_URL);
  });

  it("returns null when the generic placeholder already failed", () => {
    expect(getNextMintIconUrl(GENERIC_MINT_ICON_DATA_URL, null)).toBe(null);
  });
});

describe("isTestMintUrl", () => {
  it("identifies the offered test mint", () => {
    expect(isTestMintUrl("https://testnut.cashu.space/")).toBe(true);
  });

  it("does not flag production mints", () => {
    expect(isTestMintUrl("https://cashu.cz")).toBe(false);
  });
});

describe("mint presets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("limits development discovery and recovery to the configured mint", async () => {
    vi.stubEnv("VITE_MAIN_MINT_URL", "http://localhost:3338");
    vi.resetModules();
    const { MAIN_MINT_URL, PRESET_MINTS } = await import("./mint");
    expect(MAIN_MINT_URL).toBe("http://localhost:3338");
    expect(PRESET_MINTS).toEqual(["http://localhost:3338"]);
  });

  it("keeps the normal presets without an environment override", async () => {
    vi.stubEnv("VITE_MAIN_MINT_URL", "");
    vi.resetModules();
    const { MAIN_MINT_URL, PRESET_MINTS, PRODUCTION_MINTS } =
      await import("./mint");
    expect(MAIN_MINT_URL).toBe("https://cashu.cz");
    expect(PRESET_MINTS).toEqual([
      PRODUCTION_MINTS[0],
      "https://testnut.cashu.space",
      ...PRODUCTION_MINTS.slice(1),
    ]);
  });
});

describe("isHiddenTestMint", () => {
  it("hides test mints only while they are not allowed", () => {
    expect(isHiddenTestMint("http://localhost:3338", false)).toBe(true);
    expect(isHiddenTestMint("http://localhost:3338", true)).toBe(false);
    expect(isHiddenTestMint("https://cashu.cz", false)).toBe(false);
    expect(isHiddenTestMint(null, false)).toBe(false);
  });
});

describe("effectiveDefaultMintUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const loadWithMainMint = async (mainMint: string) => {
    vi.stubEnv("VITE_MAIN_MINT_URL", mainMint);
    vi.resetModules();
    return import("./mint");
  };

  it("falls back to the first production mint for a hidden test mint", async () => {
    const { effectiveDefaultMintUrl } = await loadWithMainMint("");
    expect(effectiveDefaultMintUrl("https://testnut.cashu.space", false)).toBe(
      "https://cashu.cz",
    );
    expect(effectiveDefaultMintUrl("https://testnut.cashu.space", true)).toBe(
      "https://testnut.cashu.space",
    );
    expect(effectiveDefaultMintUrl("https://kashu.me", false)).toBe(
      "https://kashu.me",
    );
  });

  it("keeps an unset default unless the build's main mint is hidden", async () => {
    const production = await loadWithMainMint("");
    expect(production.effectiveDefaultMintUrl(null, false)).toBeNull();

    const development = await loadWithMainMint("http://localhost:3338");
    expect(development.effectiveDefaultMintUrl(null, true)).toBeNull();
    expect(development.effectiveDefaultMintUrl(null, false)).toBe(
      "https://cashu.cz",
    );
  });
});
