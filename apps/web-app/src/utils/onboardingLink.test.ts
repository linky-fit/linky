import { describe, expect, it, vi } from "vitest";
import { buildCashuToken } from "../testUtils/cashuToken";
import { buildOnboardingUrl } from "./onboardingLink";

vi.mock("../platform/runtime", () => ({ isNativePlatform: () => false }));

describe("buildOnboardingUrl", () => {
  it("points at the current app origin without a gift", () => {
    expect(buildOnboardingUrl(null)).toBe(
      `${window.location.origin}${window.location.pathname}`,
    );
  });

  it("carries the gift token in the wallet cashu deep link", () => {
    const token = buildCashuToken();
    expect(buildOnboardingUrl(token)).toBe(
      `${window.location.origin}${window.location.pathname}#wallet?cashu=${encodeURIComponent(token)}`,
    );
  });
});
