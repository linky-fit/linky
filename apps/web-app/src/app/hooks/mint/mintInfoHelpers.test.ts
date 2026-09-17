import { describe, expect, it } from "vitest";
import { GENERIC_MINT_ICON_DATA_URL } from "../../../utils/mint";
import {
  getEncounteredMintUrls,
  getMintInfoIconUrl,
  parseMintInfoPayload,
  repairStoredMintInfoRow,
  resolveMintIcon,
} from "./mintInfoHelpers";

const bolt11Method = {
  method: "bolt11",
  unit: "sat",
  min_amount: 0,
  max_amount: 100000,
  description: true,
};

// A realistic NUT-06 /v1/info response, longer than the 1000 characters the
// stored blob used to be cut at.
const nut06Info = {
  name: "Example mint",
  pubkey: "02".padEnd(66, "ab"),
  version: "Nutshell/0.20.3",
  description: "A mint whose NUT-06 info is longer than 1000 characters",
  description_long:
    "Publishes the usual NUT-06 capability map, so the JSON text is far " +
    "longer than the 1000 characters the stored blob used to be cut at.",
  contact: [
    { method: "email", info: "ops@cashu.example" },
    { method: "twitter", info: "@cashu_example" },
    { method: "nostr", info: "npub1example" },
  ],
  motd: "",
  icon_url: "https://cashu.example/icon.png",
  urls: ["https://cashu.example"],
  time: 1_757_900_000,
  nuts: {
    "4": { methods: [bolt11Method], disabled: false },
    "5": { methods: [bolt11Method], disabled: false },
    "7": { supported: true },
    "8": { supported: true },
    "9": { supported: true },
    "10": { supported: true },
    "11": { supported: true },
    "12": { supported: true },
    "14": { supported: true },
    "15": { methods: [{ method: "bolt11", unit: "sat" }] },
    "17": {
      supported: [
        {
          method: "bolt11",
          unit: "sat",
          commands: ["bolt11_mint_quote", "bolt11_melt_quote", "proof_state"],
        },
      ],
    },
    "19": {
      ttl: 3600,
      cached_endpoints: [
        { method: "POST", path: "/v1/mint/bolt11" },
        { method: "POST", path: "/v1/swap" },
        { method: "POST", path: "/v1/melt/bolt11" },
      ],
    },
    "20": { supported: true },
  },
};

describe("getMintInfoIconUrl", () => {
  it("uses the direct icon URL returned by mint info", () => {
    expect(
      getMintInfoIconUrl(
        "https://cashu.example",
        JSON.stringify({ icon_url: "https://cdn.example/mint.png" }),
      ),
    ).toBe("https://cdn.example/mint.png");
  });

  it("resolves relative icon URLs against the mint URL", () => {
    expect(
      getMintInfoIconUrl(
        "https://mint.minibits.cash/Bitcoin",
        JSON.stringify({ icon_url: "/icons/bitcoin.png" }),
      ),
    ).toBe("https://mint.minibits.cash/icons/bitcoin.png");
  });

  it("finds nested icon fields in the info payload", () => {
    expect(
      getMintInfoIconUrl(
        "https://cashu.example",
        JSON.stringify({ metadata: { iconUrl: "./mint.webp" } }),
      ),
    ).toBe("https://cashu.example/mint.webp");
  });

  it("returns null for invalid JSON", () => {
    expect(getMintInfoIconUrl("https://cashu.example", "not-json")).toBe(null);
  });
});

describe("parseMintInfoPayload", () => {
  it("stores the complete info JSON, so a large payload still parses", () => {
    const { infoJson, supportsMpp } = parseMintInfoPayload(nut06Info);

    expect(infoJson).toBe(JSON.stringify(nut06Info));
    expect(infoJson?.length).toBeGreaterThan(1000);
    expect(supportsMpp).toBe("1");
    expect(getMintInfoIconUrl("https://cashu.example", infoJson)).toBe(
      "https://cashu.example/icon.png",
    );
  });
});

describe("repairStoredMintInfoRow", () => {
  const row = {
    feesJson: '{"ppk":100,"raw":null}',
    id: "row-1",
    infoJson: JSON.stringify(nut06Info),
    lastCheckedAtSec: 1_757_900_000,
    url: "https://cashu.example",
  };

  it("keeps rows whose stored JSON parses", () => {
    expect(repairStoredMintInfoRow(row)).toBe(row);
  });

  it("drops a blob cut at 1000 characters and clears the check time", () => {
    const truncated = { ...row, infoJson: row.infoJson.slice(0, 1000) };

    expect(repairStoredMintInfoRow(truncated)).toEqual({
      ...truncated,
      infoJson: null,
      lastCheckedAtSec: null,
    });
  });
});

describe("resolveMintIcon", () => {
  const mint = "https://cashu.example";
  const infoIcon = "https://cdn.example/mint.png";
  const infoJson = JSON.stringify({ icon_url: infoIcon });
  const favicon = "https://cashu.example/favicon.ico";

  it("prefers the icon from mint info over the favicon", () => {
    expect(resolveMintIcon(mint, infoJson, new Set())).toEqual({
      origin: "https://cashu.example",
      url: infoIcon,
      host: "cashu.example",
      failed: false,
    });
    expect(resolveMintIcon(mint, null, new Set()).url).toBe(favicon);
  });

  it("tries an icon arriving with mint info even after every fallback failed", () => {
    const failed = new Set([favicon, GENERIC_MINT_ICON_DATA_URL]);

    expect(resolveMintIcon(mint, null, failed)).toMatchObject({
      url: null,
      failed: true,
    });
    expect(resolveMintIcon(mint, infoJson, failed)).toMatchObject({
      url: infoIcon,
      failed: false,
    });
  });

  it("skips failed candidates in order and reports when none is left", () => {
    expect(resolveMintIcon(mint, infoJson, new Set([infoIcon])).url).toBe(
      favicon,
    );
    expect(
      resolveMintIcon(mint, infoJson, new Set([infoIcon, favicon])).url,
    ).toBe(GENERIC_MINT_ICON_DATA_URL);
    expect(
      resolveMintIcon(
        mint,
        infoJson,
        new Set([infoIcon, favicon, GENERIC_MINT_ICON_DATA_URL]),
      ),
    ).toMatchObject({ url: null, failed: true });
  });

  it("uses the host override before the favicon", () => {
    expect(resolveMintIcon("https://cashu.cz", null, new Set()).url).toBe(
      "https://cashu.cz/icon.webp",
    );
  });

  it("shows the generic icon when there is no origin", () => {
    expect(resolveMintIcon("", null, new Set())).toEqual({
      origin: null,
      url: GENERIC_MINT_ICON_DATA_URL,
      host: null,
      failed: false,
    });
  });
});

describe("getEncounteredMintUrls", () => {
  it("uses available proofs and ignores held, handed-out, and spent ones", () => {
    expect(
      getEncounteredMintUrls([
        { mint: "https://parsed.example/", state: "available" },
        { mint: "https://held.example", state: "held" },
        { mint: "https://out.example", state: "handedOut" },
        { mint: "https://spent.example", state: "spent" },
      ]),
    ).toEqual(["https://parsed.example"]);
  });
});
