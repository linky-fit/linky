import { describe, expect, it, vi } from "vitest";
import { buildCashuToken } from "../testUtils/cashuToken";
import { buildOnboardingUrl } from "./onboardingLink";

vi.mock("../platform/runtime", () => ({ isNativePlatform: () => false }));

const onboarderNpub =
  "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
const base = `${window.location.origin}${window.location.pathname}`;

describe("buildOnboardingUrl", () => {
  it("carries only the onboarder without a gift", () => {
    expect(buildOnboardingUrl({ giftToken: null, onboarderNpub })).toBe(
      `${base}#wallet?onboarder=${onboarderNpub}`,
    );
  });

  it("adds the gift token to the wallet cashu deep link", () => {
    const token = buildCashuToken();
    expect(buildOnboardingUrl({ giftToken: token, onboarderNpub })).toBe(
      `${base}#wallet?onboarder=${onboarderNpub}&cashu=${encodeURIComponent(token)}`,
    );
  });
});
