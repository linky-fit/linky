import { hexToBytes } from "@noble/ciphers/utils.js";
import {
  boltCardBaseUrl,
  boltCardId,
  createBoltCard,
  issueBoltCardTap,
  parseBoltCard,
  serializeBoltCard,
  verifyBoltCardTap,
} from "./card";
import { MAX_SUN_COUNTER, verifySun } from "./sun";

describe("bolt card", () => {
  test("survives storage", () => {
    const card = { ...createBoltCard(), counter: 42 };
    const restored = parseBoltCard(serializeBoltCard(card));
    expect(restored).toEqual(card);
    expect(boltCardId(card)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("treats anything else in storage as no card", () => {
    expect(parseBoltCard("")).toBeNull();
    expect(parseBoltCard('{"version":2}')).toBeNull();
    const stored = JSON.parse(serializeBoltCard(createBoltCard()));
    expect(
      parseBoltCard(JSON.stringify({ ...stored, counter: -1 })),
    ).toBeNull();
  });

  test("each tap advances the counter and carries a verifiable SUN", () => {
    const card = createBoltCard();
    const first = issueBoltCardTap(card, "https://bridge.example");
    const second =
      first && issueBoltCardTap(first.card, "https://bridge.example");
    expect(first?.counter).toBe(1);
    expect(second?.counter).toBe(2);
    expect(second?.card.counter).toBe(2);

    const url = new URL(second!.url.replace(/^lnurlw:/, "https:"));
    expect(url.host).toBe("bridge.example");
    expect(url.pathname).toBe(`/w/${boltCardId(card)}`);
    expect(url.searchParams.get("p")).toBe(second!.p);
    const sun = verifySun(
      card,
      card.uid,
      hexToBytes(url.searchParams.get("p")!),
      hexToBytes(url.searchParams.get("c")!),
    );
    expect(sun?.counter).toBe(2);
  });

  test("verifies a tap from its hex parameters", () => {
    const card = createBoltCard();
    const tap = issueBoltCardTap(card, "https://bridge.example")!;
    const c = new URL(tap.url.replace(/^lnurlw:/, "https:")).searchParams.get(
      "c",
    )!;
    expect(verifyBoltCardTap(card, tap.p, c)?.counter).toBe(1);
    expect(verifyBoltCardTap(createBoltCard(), tap.p, c)).toBeNull();
    expect(verifyBoltCardTap(card, "zz", c)).toBeNull();
  });

  test("an exhausted card issues no tap", () => {
    const card = { ...createBoltCard(), counter: MAX_SUN_COUNTER };
    expect(issueBoltCardTap(card, "https://bridge.example")).toBeNull();
  });

  test("uses lnurlw only for https bridges", () => {
    const cardId = boltCardId(createBoltCard());
    expect(boltCardBaseUrl("https://bridge.example/base/", cardId)).toBe(
      `lnurlw://bridge.example/base/w/${cardId}`,
    );
    expect(boltCardBaseUrl("http://localhost:8789", cardId)).toBe(
      `http://localhost:8789/w/${cardId}`,
    );
  });
});
