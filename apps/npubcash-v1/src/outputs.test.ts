import { describe, expect, test } from "bun:test";
import { deriveOutputs } from "./outputs";

const seed = new Uint8Array(32).fill(7);
const mintUrl = "https://mint.example";
const blinded = (quoteId: string, keysetId: string) =>
  deriveOutputs(seed, mintUrl, quoteId, [1, 4, 8], keysetId).map(
    (output) => output.blindedMessage.B_,
  );

describe("deriveOutputs", () => {
  test("derives the same outputs for a quote on any keyset", () => {
    expect(blinded("quote-a", "00aa")).toEqual(blinded("quote-a", "00bb"));
  });

  test("derives distinct outputs per quote and index", () => {
    const outputs = [
      ...blinded("quote-a", "00aa"),
      ...blinded("quote-b", "00aa"),
    ];
    expect(new Set(outputs).size).toBe(outputs.length);
  });
});
