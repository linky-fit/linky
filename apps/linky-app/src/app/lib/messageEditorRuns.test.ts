import { describe, expect, it } from "vitest";
import {
  applyDisplayEdit,
  displayOffsetOf,
  displayTextOf,
  messageEditorRuns,
  rawOffsetOf,
} from "./messageEditorRuns";

const ANN = "npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
const STRANGER = "npub1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
const labelOf = (raw: string) => (raw === ANN ? "Ann" : null);
const draft = `hi ${ANN} there`;
const runs = messageEditorRuns(draft, labelOf);

describe("messageEditorRuns", () => {
  it("shows a known contact by name and leaves an unknown npub as text", () => {
    expect(displayTextOf(runs)).toBe("hi Ann there");
    expect(displayTextOf(messageEditorRuns(`hi ${STRANGER}`, labelOf))).toBe(
      `hi ${STRANGER}`,
    );
  });

  it("maps offsets around and inside an entity", () => {
    expect(rawOffsetOf(runs, 3)).toBe(3);
    expect(rawOffsetOf(runs, 5)).toBe(3 + ANN.length);
    expect(rawOffsetOf(runs, 7)).toBe(4 + ANN.length);
    expect(displayOffsetOf(runs, 3 + ANN.length)).toBe(6);
    expect(displayOffsetOf(runs, 10)).toBe(6);
  });
});

describe("applyDisplayEdit", () => {
  it("types into the text around entities", () => {
    expect(applyDisplayEdit(runs, "hi Ann there!")).toEqual({
      value: `${draft}!`,
      caret: draft.length + 1,
    });
  });

  it("removes a whole entity when a character of it is deleted", () => {
    expect(applyDisplayEdit(runs, "hi An there")).toEqual({
      value: "hi  there",
      caret: 3,
    });
  });

  it("puts text typed inside an entity after it", () => {
    expect(applyDisplayEdit(runs, "hi Axnn there")).toEqual({
      value: `hi ${ANN}x there`,
      caret: 4 + ANN.length,
    });
  });
});
