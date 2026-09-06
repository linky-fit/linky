import { describe, expect, it } from "vitest";
import {
  extractActiveKeysetPpk,
  getMintFeePpk,
  parseMintInfoPayload,
} from "./mintInfoHelpers";

const keysets = {
  keysets: [
    { id: "a", unit: "sat", active: false, input_fee_ppk: 100 },
    { id: "b", unit: "sat", active: true, input_fee_ppk: 0 },
    { id: "c", unit: "usd", active: true, input_fee_ppk: 500 },
  ],
};

describe("mint fee parsing", () => {
  it("decodes legacy NUT and fee aliases without assuming an object", () => {
    expect(parseMintInfoPayload(null)).toEqual({
      supportsMpp: null,
      feesJson: null,
      infoJson: null,
    });
    expect(
      parseMintInfoPayload({
        NUTS: { NUT15: { methods: [] } },
        fee: { ppk: 50 },
      }),
    ).toMatchObject({
      supportsMpp: "1",
      feesJson: '{"ppk":50,"raw":{"ppk":50}}',
    });
    expect(
      parseMintInfoPayload({ nuts: "invalid", fees: { ppk: "100" } }),
    ).toMatchObject({
      supportsMpp: null,
      feesJson: '{"ppk":100,"raw":{"ppk":"100"}}',
    });
  });

  it("ignores malformed keysets while retaining valid fees", () => {
    expect(
      extractActiveKeysetPpk({
        keysets: [
          null,
          { active: true, unit: "sat", input_fee_ppk: -1 },
          { active: true, unit: "sat", input_fee_ppk: 0.5 },
          { active: true, unit: "sat", input_fee_ppk: 75 },
        ],
      }),
    ).toBe(75);
    expect(
      extractActiveKeysetPpk({ keysets: [{ active: true, unit: "sat" }] }),
    ).toBe(0);
  });

  it("prefers the active sat keyset fee over inactive ones", () => {
    expect(extractActiveKeysetPpk(keysets)).toBe(0);
    expect(extractActiveKeysetPpk({ keysets: [] })).toBeNull();
    expect(extractActiveKeysetPpk(null)).toBeNull();
  });

  it("stores the keyset ppk in feesJson and reads it back", () => {
    const parsed = parseMintInfoPayload({ name: "mint" }, keysets);
    expect(getMintFeePpk(parsed.feesJson)).toBe(0);
    expect(getMintFeePpk(null)).toBeNull();
    expect(getMintFeePpk("not json")).toBeNull();
  });
});
