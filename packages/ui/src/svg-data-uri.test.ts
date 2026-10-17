import { describe, expect, it } from "vitest";
import { svgDataUriXml } from "./svg-data-uri";

describe("svgDataUriXml", () => {
  it("decodes URL-encoded colours", () => {
    expect(svgDataUriXml("data:image/svg+xml,<svg fill='%230ea5e9'/>")).toBe(
      "<svg fill='#0ea5e9'/>",
    );
  });

  it("decodes base64 payloads", () => {
    expect(
      svgDataUriXml(
        `data:image/svg+xml;charset=utf-8;base64,${btoa("<svg/>")}`,
      ),
    ).toBe("<svg/>");
  });

  it("ignores URIs that are not SVG data", () => {
    expect(svgDataUriXml("https://example.com/a.svg")).toBeNull();
  });

  it("keeps a bare percent sign, as browsers do", () => {
    expect(
      svgDataUriXml(
        "data:image/svg+xml,<stop offset='100%' stop-color='%23fff'/>",
      ),
    ).toBe("<stop offset='100%' stop-color='#fff'/>");
  });

  it("decodes multi-byte characters", () => {
    expect(svgDataUriXml("data:image/svg+xml,<text>%C3%A9</text>")).toBe(
      "<text>é</text>",
    );
  });

  it("returns null for a malformed base64 payload", () => {
    expect(svgDataUriXml("data:image/svg+xml;base64,@@@")).toBeNull();
  });
});
