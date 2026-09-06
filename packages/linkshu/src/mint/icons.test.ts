import { describe, expect, it } from "vitest";
import { findMintInfoIconValue, getMintIconOverride } from "../index";

describe("shared mint presentation", () => {
  it("keeps the Linky mint override available to every wallet consumer", () => {
    expect(getMintIconOverride("linky.cashu.cz")).toBe(
      "https://linky-weld.vercel.app/icon.svg",
    );
  });
  it("finds nested mint icon aliases and terminates on cyclic metadata", () => {
    const metadata: { nested: { imageUrl: string }; self?: object } = {
      nested: { imageUrl: "/mint.png" },
    };
    metadata.self = metadata;
    expect(findMintInfoIconValue(metadata, new Set())).toBe("/mint.png");
    metadata.nested.imageUrl = "";
    expect(findMintInfoIconValue(metadata, new Set())).toBeNull();
  });
});
