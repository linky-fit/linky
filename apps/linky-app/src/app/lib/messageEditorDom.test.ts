// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  getMessageEditorCaret,
  getMessageEditorEntityRanges,
  getMessageEditorValue,
  setMessageEditorCaret,
} from "./messageEditorDom";

const createEditor = () => {
  const editor = document.createElement("div");
  const pill = document.createElement("span");
  pill.dataset.messageEntityValue = "npub1contact";
  pill.contentEditable = "false";
  pill.textContent = "Karel";
  editor.append(
    document.createTextNode("Ahoj "),
    pill,
    document.createTextNode(" !"),
  );
  document.body.append(editor);
  return editor;
};

describe("message editor DOM", () => {
  it("serializes a contact pill back to its npub", () => {
    const editor = createEditor();
    expect(getMessageEditorValue(editor)).toBe("Ahoj npub1contact !");
    expect(getMessageEditorEntityRanges(editor)).toEqual([
      { start: 5, end: 17, value: "npub1contact" },
    ]);
  });

  it("counts the newline of a line block in the caret offset", () => {
    const editor = document.createElement("div");
    editor.innerHTML = "first<div>second</div>";
    document.body.appendChild(editor);
    const secondText = editor.lastChild?.firstChild;
    if (!secondText) throw new Error("missing second line");
    const selection = window.getSelection();
    if (!selection) throw new Error("missing selection");
    const range = document.createRange();
    range.setStart(secondText, 3);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(getMessageEditorCaret(editor)).toBe("first\nsec".length);
    editor.remove();
  });

  it("serializes browser-inserted line blocks as newlines", () => {
    const editor = document.createElement("div");
    editor.innerHTML =
      "first<div>second</div><div><br></div><div>fourth<br></div>";
    expect(getMessageEditorValue(editor)).toBe("first\nsecond\n\nfourth");
  });

  it("keeps logical caret offsets across an atomic pill", () => {
    const editor = createEditor();
    setMessageEditorCaret(editor, 17);
    expect(getMessageEditorCaret(editor)).toBe(17);
  });
});
