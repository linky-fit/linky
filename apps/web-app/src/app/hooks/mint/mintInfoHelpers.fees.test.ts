import { MintInfo, MintUrl } from "@linky-fit/linkshu";
import { describe, expect, it } from "vitest";
import {
  getMintFeePpk,
  getMintInfoIconUrl,
  mintInfoRowFields,
} from "./mintInfoHelpers";

const info = (overrides: Partial<MintInfo> = {}) =>
  new MintInfo({
    url: MintUrl.make("https://cashu.example"),
    name: "Cashu example",
    inputFeePpk: 100,
    supportsMpp: true,
    supportsP2pk: false,
    isFakeLightning: false,
    iconUrl: "https://cashu.example/icon.png",
    ...overrides,
  });

describe("mintInfoRowFields", () => {
  it("stores what the fee row, the icon and MPP read back", () => {
    const fields = mintInfoRowFields(info());

    expect(getMintFeePpk(fields.feesJson)).toBe(100);
    expect(getMintInfoIconUrl("https://cashu.example", fields.infoJson)).toBe(
      "https://cashu.example/icon.png",
    );
    expect(fields.supportsMpp).toBe("1");
  });

  it("stores a zero fee as known and a missing one as unknown", () => {
    expect(
      getMintFeePpk(mintInfoRowFields(info({ inputFeePpk: 0 })).feesJson),
    ).toBe(0);
    expect(
      mintInfoRowFields(info({ inputFeePpk: null, supportsMpp: false })),
    ).toMatchObject({ feesJson: null, supportsMpp: null });
  });

  it("keeps infoJson without an icon", () => {
    const { infoJson } = mintInfoRowFields(info({ iconUrl: null }));

    expect(infoJson).not.toBeNull();
    expect(getMintInfoIconUrl("https://cashu.example", infoJson)).toBeNull();
  });
});

describe("getMintFeePpk", () => {
  it("reads null for a missing or broken blob", () => {
    expect(getMintFeePpk(null)).toBeNull();
    expect(getMintFeePpk("not json")).toBeNull();
  });
});
