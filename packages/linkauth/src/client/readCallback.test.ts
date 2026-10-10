import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAssertion } from "../callback.js";
import { newKey, signLogin } from "../testing/fixtures.js";
import { clearCallback, readCallback } from "./readCallback.js";

const assertion = signLogin(newKey());

describe("readCallback", () => {
  it("decodes the result from a URL or a bare hash", () => {
    const hash = `#linkauth=${encodeAssertion(assertion)}`;
    expect(readCallback(`https://shop.example/done${hash}`)).toEqual({
      assertion,
    });
    expect(readCallback(hash)).toEqual({ assertion });
  });

  it("survives JSON with non-ASCII content", () => {
    const odd = { ...assertion, content: "Přihlášení 🔑" };
    expect(readCallback(`#linkauth=${encodeAssertion(odd)}`)).toEqual({
      assertion: odd,
    });
  });

  it("reports denial and unknown errors", () => {
    expect(readCallback("#linkauth_error=denied")).toEqual({ error: "denied" });
    expect(readCallback("#linkauth_error=boom")).toEqual({ error: "invalid" });
  });

  it.each([
    "#linkauth=not-base64!",
    "#linkauth=e30",
    `#linkauth=${"A".repeat(40)}`,
  ])("flags an unusable result %s", (hash) => {
    expect(readCallback(hash)).toEqual({ error: "invalid" });
  });

  it("returns null when no signer was involved", () => {
    expect(readCallback("")).toBeNull();
    expect(readCallback("https://shop.example/done#section")).toBeNull();
    expect(readCallback("#other=1")).toBeNull();
  });
});

describe("clearCallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops the fragment and keeps path and query", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", {
      pathname: "/done",
      search: "?next=%2Fcart",
      hash: "#linkauth=x",
    });
    vi.stubGlobal("history", { state: { a: 1 }, replaceState });
    clearCallback();
    expect(replaceState).toHaveBeenCalledWith(
      { a: 1 },
      "",
      "/done?next=%2Fcart",
    );
  });
});
