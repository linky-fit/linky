import { describe, expect, it } from "vitest";
import { STATIC_QR_MAX_VERSION, staticQrVersion } from "./useTokenQr";

const tokenOf = (chars: number): string =>
  `cashuB${"o2FtcGh0dHBzOi8vY2FzaHUuY3phdWNzYXRhdIGiYWlIAbqH8lOtAF9hcI".repeat(60)}`.slice(
    0,
    chars,
  );

describe("static QR threshold", () => {
  it("keeps a small token on one code", async () => {
    const version = await staticQrVersion(tokenOf(300));
    expect(version).not.toBeNull();
    expect(version).toBeLessThanOrEqual(STATIC_QR_MAX_VERSION);
  });

  it("hands a dense token to the animation before it stops fitting", async () => {
    // Fits a version-39 symbol, which no phone camera reads off a screen.
    const version = await staticQrVersion(tokenOf(2200));
    expect(version).not.toBeNull();
    expect(version).toBeGreaterThan(STATIC_QR_MAX_VERSION);
  });

  it("reports a token past version 40 as unfit for any single code", async () => {
    expect(await staticQrVersion(tokenOf(3000))).toBeNull();
  });
});
