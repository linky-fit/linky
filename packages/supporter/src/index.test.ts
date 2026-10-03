import {
  isSupporterAwardValid,
  supporterAwardExpiresAt,
  supporterTierForAmount,
  supporterTierIncludes,
} from "./index";

const at = (iso: string): number => Date.parse(iso) / 1000;

describe("supporterTierForAmount", () => {
  it.each([
    [4_999, null],
    [5_000, "bronze"],
    [20_000, "silver"],
    [50_000, "gold"],
    [499_999, "gold"],
    [1_000_000, "diamond"],
  ])("%d sat reaches %s", (amount, tier) => {
    expect(supporterTierForAmount(amount)).toBe(tier);
  });
});

describe("supporterTierIncludes", () => {
  it("includes every lower tier", () => {
    expect(supporterTierIncludes("gold", "bronze")).toBe(true);
    expect(supporterTierIncludes("gold", "gold")).toBe(true);
    expect(supporterTierIncludes("silver", "gold")).toBe(false);
  });
});

describe("supporterAwardExpiresAt", () => {
  it("adds one calendar month and seven days", () => {
    expect(supporterAwardExpiresAt(at("2026-10-03T12:00:00Z"))).toBe(
      at("2026-11-10T12:00:00Z"),
    );
  });

  it("clamps to the end of a shorter month", () => {
    expect(supporterAwardExpiresAt(at("2026-01-31T00:00:00Z"))).toBe(
      at("2026-03-07T00:00:00Z"),
    );
  });

  it("uses the override when given", () => {
    expect(supporterAwardExpiresAt(100, 60)).toBe(160);
  });
});

describe("isSupporterAwardValid", () => {
  const awardedAt = at("2026-10-03T00:00:00Z");

  it("counts until the expiry", () => {
    expect(isSupporterAwardValid(awardedAt, at("2026-11-09T23:59:59Z"))).toBe(
      true,
    );
    expect(isSupporterAwardValid(awardedAt, at("2026-11-10T00:00:00Z"))).toBe(
      false,
    );
  });

  it("counts an award dated ahead of a lagging device clock", () => {
    expect(isSupporterAwardValid(awardedAt, awardedAt - 60)).toBe(true);
  });
});
