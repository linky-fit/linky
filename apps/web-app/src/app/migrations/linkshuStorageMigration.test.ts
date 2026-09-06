// Legacy migration; removal gate in docs/architecture.md

import { beforeEach, describe, expect, it } from "vitest";
import {
  migrateLegacyCashuLocalState,
  seedLinkshuSeenMintsFromTokenRows,
} from "./linkshuStorageMigration";

const MINT = "https://mint.example.com";
const ENC_MINT = encodeURIComponent(MINT);

const LEGACY_COUNTER_KEY = `linky.cashu.detCounter.v1:${ENC_MINT}:sat:00ffab12`;
const LEGACY_CURSOR_KEY = `linky.cashu.restoreCursor.v1:${ENC_MINT}:sat:00ffab12`;
const LINKSHU_COUNTER_KEY = `linky.linkshu.value.linkshu.detCounter.${ENC_MINT}.sat.00ffab12`;
const LINKSHU_CURSOR_KEY = `linky.linkshu.value.linkshu.restoreCursor.${ENC_MINT}.sat.00ffab12`;

const linkshuSeenMintKey = (mint: string): string =>
  `linky.linkshu.value.linkshu.seenMints.${encodeURIComponent(mint)}`;

const storageSnapshot = (): Record<string, string> => {
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null) snapshot[key] = localStorage.getItem(key) ?? "";
  }
  return snapshot;
};

beforeEach(() => {
  localStorage.clear();
});

describe("migrateLegacyCashuLocalState", () => {
  it("copies counter and restore-cursor values verbatim to the exact linkshu keys and deletes the legacy keys", () => {
    localStorage.setItem(LEGACY_COUNTER_KEY, "412");
    localStorage.setItem(LEGACY_CURSOR_KEY, "377");

    migrateLegacyCashuLocalState();

    expect(localStorage.getItem(LINKSHU_COUNTER_KEY)).toBe("412");
    expect(localStorage.getItem(LINKSHU_CURSOR_KEY)).toBe("377");
    expect(localStorage.getItem(LEGACY_COUNTER_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_CURSOR_KEY)).toBeNull();
  });

  it("keeps an existing linkshu value on collision and still deletes the legacy key", () => {
    localStorage.setItem(LEGACY_COUNTER_KEY, "412");
    localStorage.setItem(LINKSHU_COUNTER_KEY, "500");

    migrateLegacyCashuLocalState();

    expect(localStorage.getItem(LINKSHU_COUNTER_KEY)).toBe("500");
    expect(localStorage.getItem(LEGACY_COUNTER_KEY)).toBeNull();
  });

  it("drops a legacy key with a malformed scope without creating anything", () => {
    const malformed = `linky.cashu.detCounter.v1:${ENC_MINT}:sat`;
    localStorage.setItem(malformed, "9");

    migrateLegacyCashuLocalState();

    expect(localStorage.getItem(malformed)).toBeNull();
    const created = Object.keys(storageSnapshot()).filter((key) =>
      key.startsWith("linky.linkshu.value.linkshu.detCounter."),
    );
    expect(created).toEqual([]);
  });

  it("deletes stale lock, claimed-stash, and claim-lock keys", () => {
    const doomed = [
      `linky.cashu.detCounterLock.v1:${ENC_MINT}:sat:00ffab12`,
      `linky.topup.claimed.v1.owner1.${ENC_MINT}.quote1`,
      `linky.autoswap.claimed.v1.owner1.${ENC_MINT}.quote2`,
      `linky.topup.claimLock.v1.owner1.${ENC_MINT}.quote1`,
    ];
    for (const key of doomed) localStorage.setItem(key, "{}");

    migrateLegacyCashuLocalState();

    for (const key of doomed) expect(localStorage.getItem(key)).toBeNull();
  });

  describe("pending topup-quote conversion", () => {
    const LEGACY_TOPUP_KEY = "linky.local.pendingTopupQuote.v1.owner1";
    const LINKSHU_TOPUP_KEY = `linky.linkshu.value.linkshu.pendingTopup.${ENC_MINT}.quoteX`;
    const legacyTopupRecord = {
      amount: 53,
      createdAtMs: 1756700000123,
      invoice: "lnbc530n1fakeinvoice",
      mintUrl: MINT,
      quote: "quoteX",
      unit: "sat",
    };

    it("converts a pending topup quote into linkshu's pending-record format, scoped to the legacy counter's keyset", () => {
      localStorage.setItem(LEGACY_COUNTER_KEY, "412");
      localStorage.setItem(LEGACY_TOPUP_KEY, JSON.stringify(legacyTopupRecord));

      migrateLegacyCashuLocalState();

      expect(localStorage.getItem(LEGACY_TOPUP_KEY)).toBeNull();
      const written = localStorage.getItem(LINKSHU_TOPUP_KEY);
      expect(written).not.toBeNull();
      expect(JSON.parse(written ?? "")).toEqual({
        quoteId: "quoteX",
        mint: MINT,
        unit: "sat",
        keysetId: "00ffab12",
        amount: 53,
        invoice: "lnbc530n1fakeinvoice",
        expiresAt: null,
        createdAt: 1756700000,
        mintCounter: null,
      });
    });

    it("falls back to the placeholder keyset id when no legacy counter or cursor names one", () => {
      localStorage.setItem(LEGACY_TOPUP_KEY, JSON.stringify(legacyTopupRecord));

      migrateLegacyCashuLocalState();

      expect(
        JSON.parse(localStorage.getItem(LINKSHU_TOPUP_KEY) ?? ""),
      ).toMatchObject({ keysetId: "00" });
    });

    it("defaults a null legacy unit to sat", () => {
      localStorage.setItem(
        LEGACY_TOPUP_KEY,
        JSON.stringify({ ...legacyTopupRecord, unit: null }),
      );

      migrateLegacyCashuLocalState();

      expect(
        JSON.parse(localStorage.getItem(LINKSHU_TOPUP_KEY) ?? ""),
      ).toMatchObject({ unit: "sat" });
    });

    it("drops a malformed or invoice-less record without writing anything", () => {
      localStorage.setItem(LEGACY_TOPUP_KEY, "not json at all");
      localStorage.setItem(
        "linky.local.pendingTopupQuote.v1.owner2",
        JSON.stringify({ ...legacyTopupRecord, invoice: null }),
      );

      migrateLegacyCashuLocalState();

      expect(localStorage.getItem(LEGACY_TOPUP_KEY)).toBeNull();
      expect(
        localStorage.getItem("linky.local.pendingTopupQuote.v1.owner2"),
      ).toBeNull();
      const created = Object.keys(storageSnapshot()).filter((key) =>
        key.startsWith("linky.linkshu.value.linkshu.pendingTopup."),
      );
      expect(created).toEqual([]);
    });

    it("keeps an existing linkshu pending record on collision and still deletes the legacy key", () => {
      localStorage.setItem(LINKSHU_TOPUP_KEY, '{"existing":"record"}');
      localStorage.setItem(LEGACY_TOPUP_KEY, JSON.stringify(legacyTopupRecord));

      migrateLegacyCashuLocalState();

      expect(localStorage.getItem(LINKSHU_TOPUP_KEY)).toBe(
        '{"existing":"record"}',
      );
      expect(localStorage.getItem(LEGACY_TOPUP_KEY)).toBeNull();
    });

    it("is idempotent: a re-run leaves the converted record untouched", () => {
      localStorage.setItem(LEGACY_COUNTER_KEY, "412");
      localStorage.setItem(LEGACY_TOPUP_KEY, JSON.stringify(legacyTopupRecord));

      migrateLegacyCashuLocalState();
      const afterFirstRun = storageSnapshot();

      migrateLegacyCashuLocalState();
      expect(storageSnapshot()).toEqual(afterFirstRun);
    });
  });

  describe("pending autoswap-claim conversion", () => {
    const LEGACY_AUTOSWAP_KEY = "linky.local.pendingAutoswapClaim.v1.owner1";
    const legacyClaim = (quote: string, amount: number) => ({
      amount,
      createdAtMs: 1756700000123,
      invoice: `lnbc${quote}fake`,
      mintUrl: MINT,
      quote,
      unit: "sat",
    });

    it("converts every array entry into its own linkshu pending-claim record with the target mint as sourceMint", () => {
      localStorage.setItem(LEGACY_CURSOR_KEY, "377");
      localStorage.setItem(
        LEGACY_AUTOSWAP_KEY,
        JSON.stringify([legacyClaim("quoteA", 21), legacyClaim("quoteB", 42)]),
      );

      migrateLegacyCashuLocalState();

      expect(localStorage.getItem(LEGACY_AUTOSWAP_KEY)).toBeNull();
      const keyA = `linky.linkshu.value.linkshu.pendingAutoswapClaim.${ENC_MINT}.quoteA`;
      expect(JSON.parse(localStorage.getItem(keyA) ?? "")).toEqual({
        quoteId: "quoteA",
        mint: MINT,
        unit: "sat",
        keysetId: "00ffab12",
        amount: 21,
        invoice: "lnbcquoteAfake",
        sourceMint: MINT,
        createdAt: 1756700000,
        mintCounter: null,
      });
      const keyB = `linky.linkshu.value.linkshu.pendingAutoswapClaim.${ENC_MINT}.quoteB`;
      expect(JSON.parse(localStorage.getItem(keyB) ?? "")).toMatchObject({
        quoteId: "quoteB",
        amount: 42,
      });
    });

    it("drops malformed entries while converting valid ones from the same array", () => {
      localStorage.setItem(
        LEGACY_AUTOSWAP_KEY,
        JSON.stringify([
          legacyClaim("quoteA", 21),
          { mintUrl: "not a url", quote: "quoteBad" },
        ]),
      );

      migrateLegacyCashuLocalState();

      expect(localStorage.getItem(LEGACY_AUTOSWAP_KEY)).toBeNull();
      const created = Object.keys(storageSnapshot()).filter((key) =>
        key.startsWith("linky.linkshu.value.linkshu.pendingAutoswapClaim."),
      );
      expect(created).toEqual([
        `linky.linkshu.value.linkshu.pendingAutoswapClaim.${ENC_MINT}.quoteA`,
      ]);
    });
  });

  it("seeds linkshu seen-mint keys from every legacy owner-scoped array and keeps the legacy arrays", () => {
    const ownerAKey = "linky.cashu.seenMints.v1.ownerA";
    const ownerBKey = "linky.cashu.seenMints.v1.anon";
    localStorage.setItem(
      ownerAKey,
      JSON.stringify([MINT, "https://cashu.cz", "not a url"]),
    );
    localStorage.setItem(
      ownerBKey,
      JSON.stringify(["https://mint.minibits.cash/Bitcoin"]),
    );

    migrateLegacyCashuLocalState();

    expect(localStorage.getItem(linkshuSeenMintKey(MINT))).toBe(MINT);
    expect(localStorage.getItem(linkshuSeenMintKey("https://cashu.cz"))).toBe(
      "https://cashu.cz",
    );
    expect(
      localStorage.getItem(
        linkshuSeenMintKey("https://mint.minibits.cash/Bitcoin"),
      ),
    ).toBe("https://mint.minibits.cash/Bitcoin");
    expect(localStorage.getItem(linkshuSeenMintKey("not a url"))).toBeNull();
    expect(localStorage.getItem(ownerAKey)).not.toBeNull();
    expect(localStorage.getItem(ownerBKey)).not.toBeNull();
  });

  it("leaves unrelated linky keys untouched", () => {
    localStorage.setItem("linky.cashu.defaultMintOverride.v1", MINT);
    localStorage.setItem("linky.nostr_nsec", "nsec1notreal");
    localStorage.setItem("linky.lastAcceptedCashuToken.v1", "cashuAabc");

    migrateLegacyCashuLocalState();

    expect(localStorage.getItem("linky.cashu.defaultMintOverride.v1")).toBe(
      MINT,
    );
    expect(localStorage.getItem("linky.nostr_nsec")).toBe("nsec1notreal");
    expect(localStorage.getItem("linky.lastAcceptedCashuToken.v1")).toBe(
      "cashuAabc",
    );
  });

  it("is idempotent: a second run is a no-op even when new legacy-format keys appear", () => {
    localStorage.setItem(LEGACY_COUNTER_KEY, "412");
    migrateLegacyCashuLocalState();
    const afterFirstRun = storageSnapshot();
    expect(afterFirstRun["linky.linkshu_storage_migration_v1"]).toBe("1");

    migrateLegacyCashuLocalState();
    expect(storageSnapshot()).toEqual(afterFirstRun);

    localStorage.setItem(LEGACY_CURSOR_KEY, "9999");
    migrateLegacyCashuLocalState();
    expect(localStorage.getItem(LEGACY_CURSOR_KEY)).toBe("9999");
    expect(localStorage.getItem(LINKSHU_CURSOR_KEY)).toBeNull();
  });
});

describe("seedLinkshuSeenMintsFromTokenRows", () => {
  const jsonToken = (mint: string): string =>
    JSON.stringify({
      mint,
      proofs: [{ id: "00aa", amount: 2, secret: "s", C: "c" }],
    });

  it("seeds seen-mint keys from the mint column and from token text, then completes", () => {
    seedLinkshuSeenMintsFromTokenRows([
      { mint: MINT, rawToken: null, token: "cashuAnotdecodable" },
      {
        mint: null,
        rawToken: jsonToken("https://mint.row.example"),
        token: null,
      },
    ]);

    expect(localStorage.getItem(linkshuSeenMintKey(MINT))).toBe(MINT);
    expect(
      localStorage.getItem(linkshuSeenMintKey("https://mint.row.example")),
    ).toBe("https://mint.row.example");
    expect(localStorage.getItem("linky.linkshu_seen_mints_backfill_v1")).toBe(
      "1",
    );
  });

  it("does nothing (and stays pending) for an empty row set", () => {
    seedLinkshuSeenMintsFromTokenRows([]);
    expect(storageSnapshot()).toEqual({});
  });

  it("is a no-op once completed", () => {
    seedLinkshuSeenMintsFromTokenRows([
      { mint: MINT, rawToken: null, token: null },
    ]);
    seedLinkshuSeenMintsFromTokenRows([
      { mint: "https://mint.late.example", rawToken: null, token: null },
    ]);

    expect(
      localStorage.getItem(linkshuSeenMintKey("https://mint.late.example")),
    ).toBeNull();
  });

  it("never overwrites an existing linkshu seen-mint key", () => {
    localStorage.setItem(linkshuSeenMintKey(MINT), MINT);
    const before = storageSnapshot();

    seedLinkshuSeenMintsFromTokenRows([
      { mint: MINT, rawToken: null, token: null },
    ]);

    expect(localStorage.getItem(linkshuSeenMintKey(MINT))).toBe(MINT);
    expect(storageSnapshot()).toEqual({
      ...before,
      "linky.linkshu_seen_mints_backfill_v1": "1",
    });
  });
});
