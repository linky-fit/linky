import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { getUnknownErrorMessage } from "./unknown";

class RelayRefused extends Schema.TaggedError<RelayRefused>()("RelayRefused", {
  relay: Schema.String,
}) {}

class MintRejected extends Schema.TaggedError<MintRejected>()("MintRejected", {
  detail: Schema.String,
}) {}

const thrownBy = (run: () => unknown): unknown => {
  try {
    return run();
  } catch (error) {
    return error;
  }
};

class Bare extends Schema.TaggedError<Bare>()("Bare", {}) {}

describe("getUnknownErrorMessage", () => {
  it("preserves structured validation errors", () => {
    expect(
      getUnknownErrorMessage(
        { type: "Object", errors: [{ key: "id", type: "UnexpectedKey" }] },
        "unknown",
      ),
    ).toBe('{"type":"Object","errors":[{"key":"id","type":"UnexpectedKey"}]}');
  });

  it("describes a tagged error that has no message by its tag and fields", () => {
    expect(
      getUnknownErrorMessage(new RelayRefused({ relay: "wss://r" }), "unknown"),
    ).toBe('RelayRefused {"relay":"wss://r"}');
    expect(getUnknownErrorMessage(new Bare(), "unknown")).toBe("Bare");
  });

  it("uses the readable text for linkshu tagged errors", () => {
    expect(
      getUnknownErrorMessage(new MintRejected({ detail: "bad" }), "unknown"),
    ).toBe("Mint rejected the token: bad");
  });

  it("includes the schema issue of a failed class construction", () => {
    expect(
      getUnknownErrorMessage(
        thrownBy(() => RelayRefused.make({ relay: JSON.parse("1") })),
        "unknown",
      ),
    ).toBe('Schema validation failed: Expected string\n  at ["relay"]');
  });
});
