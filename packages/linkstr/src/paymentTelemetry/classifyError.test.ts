import { describe, expect, it } from "vitest";
import { classifyPaymentErrorCode } from "../index";

describe("payment telemetry identity failures", () => {
  it("preserves separate public-key and secret-key failure categories", () => {
    expect(classifyPaymentErrorCode("Invalid npub")).toBe("invalid_npub");
    expect(classifyPaymentErrorCode("Invalid nsec")).toBe("invalid_nsec");
  });
});
