import { describe, expect, it } from "vitest";
import {
  buildBip321PaymentUri,
  parseBip321Uri,
  pickBip321PayableLeg,
} from "./bip321";

describe("parseBip321Uri", () => {
  it("returns null for non-bitcoin: input", () => {
    expect(parseBip321Uri("")).toBeNull();
    expect(parseBip321Uri("lnbc1...")).toBeNull();
    expect(parseBip321Uri("https://example.com")).toBeNull();
  });

  it("accepts a bare address (BIP 21 style)", () => {
    const parsed = parseBip321Uri("bitcoin:bc1qabc");
    expect(parsed).toMatchObject({
      address: "bc1qabc",
      amountBtc: null,
      amountSat: null,
      lightning: null,
      creq: null,
      lnurl: null,
      lno: null,
      label: null,
      message: null,
      lnAddress: null,
    });
    expect(parsed?.extensions).toEqual({});
  });

  it("parses amount + label + message", () => {
    const parsed = parseBip321Uri(
      "bitcoin:bc1qabc?amount=0.001&label=Beer&message=Tip",
    );
    expect(parsed?.address).toBe("bc1qabc");
    expect(parsed?.amountBtc).toBe(0.001);
    expect(parsed?.amountSat).toBe(100000);
    expect(parsed?.label).toBe("Beer");
    expect(parsed?.message).toBe("Tip");
  });

  it("URL-decodes label and message", () => {
    const parsed = parseBip321Uri(
      "bitcoin:bc1qabc?label=Wine%20%26%20Beer&message=Tip%20jar",
    );
    expect(parsed?.label).toBe("Wine & Beer");
    expect(parsed?.message).toBe("Tip jar");
  });

  it("extracts a lightning BOLT11", () => {
    const parsed = parseBip321Uri(
      "bitcoin:bc1qabc?lightning=lnbc11110n1p4zjw6t",
    );
    expect(parsed?.lightning).toBe("lnbc11110n1p4zjw6t");
  });

  it("extracts a cashu request", () => {
    const parsed = parseBip321Uri("bitcoin:?creq=creqAabc123");

    expect(parsed?.creq).toBe("creqAabc123");
    expect(parsed?.extensions).toEqual({});
  });

  it("strips a `lightning:` prefix from the lightning param", () => {
    const parsed = parseBip321Uri(
      "bitcoin:bc1qabc?lightning=lightning:lnbc11110n1p4zjw6t",
    );
    expect(parsed?.lightning).toBe("lnbc11110n1p4zjw6t");
  });

  it("extracts LNURL", () => {
    const parsed = parseBip321Uri(
      "bitcoin:bc1qabc?lnurl=LNURL1DP68GURN8GHJ7MT9V4682UPWDFJKGMNPV3MXZCM9WSHX7UN89AKXUTMJV9NXVMR99UM95V2YTP45S0M3W4SKUARFW3UN6VGDKLT60",
    );
    expect(parsed?.lnurl).toMatch(/^LNURL/i);
  });

  it("captures extension params (ark) without breaking core fields", () => {
    const raw =
      "bitcoin:bc1pxez34ml0ngfcm9cw9n5yept8dc63vxqkvpqdr8um24682wpdxy3sa5shar?ark=ark1pu6h30w3zqqp2d4tety2d24luzmg6fvnjuh9rgjxk2hnxs28kmscs4zhlx3apq7pzqyp77zykeswfgp3dmk7t54uty2wcn6w9ncgpcqy34g572fpahll8njc9k6g3n&lightning=lnbc11110n1p4zjw6tsp54wzahdp55l82dxlqa53yy0zysx4xxs2qeyz6khyma5lqlcujzyeqpp5ns3ayz4af2jn2k403kqry3k0sdc8wfp0alteja4fklua0px2sqrsdqqxqy9gcqcqzxg9qyysgqw8ak36hj0aw7lsp5lftlzfqxra47muthu2qazvj74pqwhe3sqqvrzsc6k4a47mttgagpnzdwzz42q9kmxru7axr309m5eau5y6d0s3qp5wwdts&amount=0.00001111";
    const parsed = parseBip321Uri(raw);
    expect(parsed?.address).toBe(
      "bc1pxez34ml0ngfcm9cw9n5yept8dc63vxqkvpqdr8um24682wpdxy3sa5shar",
    );
    expect(parsed?.amountBtc).toBe(0.00001111);
    expect(parsed?.amountSat).toBe(1111);
    expect(parsed?.lightning).toMatch(/^lnbc11110n/);
    expect(parsed?.extensions.ark).toMatch(/^ark1/);
  });

  it("handles uppercase scheme", () => {
    const parsed = parseBip321Uri("BITCOIN:bc1qabc?amount=0.5");
    expect(parsed?.address).toBe("bc1qabc");
    expect(parsed?.amountBtc).toBe(0.5);
  });

  it("treats addressless lightning-only URI as valid", () => {
    const parsed = parseBip321Uri("bitcoin:?lightning=lnbc1abc");
    expect(parsed?.address).toBeNull();
    expect(parsed?.lightning).toBe("lnbc1abc");
  });

  it("captures a lightning address smuggled into the address part", () => {
    const parsed = parseBip321Uri("bitcoin:alice@example.com?amount=0.0001");
    expect(parsed?.lnAddress).toBe("alice@example.com");
    expect(parsed?.address).toBeNull();
    expect(parsed?.amountSat).toBe(10000);
  });

  it("ignores invalid amount values", () => {
    expect(parseBip321Uri("bitcoin:bc1qabc?amount=abc")?.amountSat).toBeNull();
    expect(parseBip321Uri("bitcoin:bc1qabc?amount=-1")?.amountSat).toBeNull();
    expect(parseBip321Uri("bitcoin:bc1qabc?amount=")?.amountSat).toBeNull();
  });

  it("builds a multi-rail URI with lightning and cashu request", () => {
    const uri = buildBip321PaymentUri({
      lightning: "lightning:lnbc1abc",
      creq: "creqAabc123",
    });

    expect(uri).toBe("bitcoin:?lightning=lnbc1abc&creq=creqAabc123");
    expect(parseBip321Uri(uri ?? "")?.lightning).toBe("lnbc1abc");
    expect(parseBip321Uri(uri ?? "")?.creq).toBe("creqAabc123");
  });
});

describe("pickBip321PayableLeg", () => {
  it("prefers Cashu request over BOLT11", () => {
    const parsed = parseBip321Uri(
      "bitcoin:?lightning=lnbc1abc&creq=creqAabc123",
    );
    expect(pickBip321PayableLeg(parsed!)).toEqual({
      kind: "cashu-request",
      value: "creqAabc123",
    });
  });

  it("prefers BOLT11 over LNURL", () => {
    const parsed = parseBip321Uri(
      "bitcoin:bc1qabc?lightning=lnbc1abc&lnurl=LNURL1xyz",
    );
    expect(pickBip321PayableLeg(parsed!)).toEqual({
      kind: "lightning",
      value: "lnbc1abc",
    });
  });

  it("falls back to LNURL when no BOLT11 is present", () => {
    const parsed = parseBip321Uri("bitcoin:bc1qabc?lnurl=LNURL1xyz");
    expect(pickBip321PayableLeg(parsed!)).toEqual({
      kind: "lnurl",
      value: "LNURL1xyz",
    });
  });

  it("falls back to a lightning address when present", () => {
    const parsed = parseBip321Uri("bitcoin:alice@example.com");
    expect(pickBip321PayableLeg(parsed!)).toEqual({
      kind: "ln-address",
      value: "alice@example.com",
    });
  });

  it("returns null for onchain-only URIs", () => {
    const parsed = parseBip321Uri("bitcoin:bc1qabc?amount=0.001&label=Pizza");
    expect(pickBip321PayableLeg(parsed!)).toBeNull();
  });

  it("returns null for unsupported rails (BOLT12 lno)", () => {
    const parsed = parseBip321Uri("bitcoin:bc1qabc?lno=lno1abc");
    expect(pickBip321PayableLeg(parsed!)).toBeNull();
  });

  it("ignores a `lightning` value that is not a BOLT11", () => {
    const parsed = parseBip321Uri("bitcoin:bc1qabc?lightning=garbage");
    expect(pickBip321PayableLeg(parsed!)).toBeNull();
  });
});
