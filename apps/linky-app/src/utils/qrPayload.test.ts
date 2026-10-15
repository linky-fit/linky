import { describe, expect, it } from "vitest";
import { optimizeCaseInsensitiveQrPayload } from "./qrPayload";

describe("optimizeCaseInsensitiveQrPayload", () => {
  it("uppercases Bech32-style data for QR alphanumeric mode", () => {
    expect(
      optimizeCaseInsensitiveQrPayload("lnbc10n1qpzry9x8gf2tvdw0s3jn54kh"),
    ).toBe("LNBC10N1QPZRY9X8GF2TVDW0S3JN54KH");
  });

  it("preserves data that cannot use QR alphanumeric mode", () => {
    expect(optimizeCaseInsensitiveQrPayload("case-sensitive_value")).toBe(
      "case-sensitive_value",
    );
  });
});
