import { describe, expect, it } from "vitest";
import { NOTE_MAX_CHARS, paymentNote } from "./note";

describe("paymentNote", () => {
  it("keeps a note as one line of plain text", () => {
    expect(paymentNote("  Za kávu\n\tdíky! ☕ ")).toBe("Za kávu díky! ☕");
    expect(paymentNote("a\u0000b‮c")).toBe("a bc");
  });

  it("is null without text", () => {
    expect(paymentNote(null)).toBeNull();
    expect(paymentNote(" \n ")).toBeNull();
  });

  it("cuts a long note without splitting a character", () => {
    const note = paymentNote("😀".repeat(NOTE_MAX_CHARS + 5));
    expect(Array.from(note ?? "")).toHaveLength(NOTE_MAX_CHARS);
    expect(note?.endsWith("😀…")).toBe(true);
  });
});
