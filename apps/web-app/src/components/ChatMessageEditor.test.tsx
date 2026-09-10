import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { setMessageEditorCaret } from "../app/lib/messageEditorDom";
import { ChatMessageEditor } from "./ChatMessageEditor";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    formatDisplayedAmountText: (amountSat: number) => `${amountSat} sat`,
  }),
}));

const FIRST_NPUB =
  "npub180cvv07tqw7jwr9wnh4hp24w3wl74x64l0n6ms4qxp2vj8qz9c8sv96q8j";
const SECOND_NPUB =
  "npub1ds24l0swau3y5z52rap9dde3jg9nuq4lqeutnsuzrscmqkt8zv0q8r3n6l";

describe("ChatMessageEditor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it.each([
    { kind: "image", disabled: false, expectedText: "Draft" },
    { kind: "text", disabled: false, expectedText: "Drpasted textaft" },
    { kind: "image", disabled: true, expectedText: "Draft" },
  ])(
    "pastes $kind with disabled=$disabled",
    async ({ kind, disabled, expectedText }) => {
      const onChange = vi.fn();
      const onPasteImages = vi.fn();
      const image = new File(["image bytes"], "image.png", {
        type: "image/png",
      });
      const { container, root } = await renderIntoDocument(
        <ChatMessageEditor
          disabled={disabled}
          getCashuTokenMessageInfo={() => null}
          getMintIconUrl={() => ({ url: null })}
          getNpubMessageContactInfo={() => null}
          onCaretChange={() => undefined}
          onChange={onChange}
          onPasteImages={onPasteImages}
          onSendShortcut={() => undefined}
          placeholder="Message"
          removeContactLabel="Remove contact from message"
          value="Draft"
        />,
      );
      const editor = container.querySelector<HTMLDivElement>("[role=textbox]");
      if (!editor) throw new Error("Missing editor");
      editor.focus();
      setMessageEditorCaret(editor, 2);
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: {
          files:
            kind === "image"
              ? [new File(["text"], "note.txt", { type: "text/plain" }), image]
              : [],
          getData: (format: string) =>
            format === "text/plain" ? "pasted text" : "<b>pasted text</b>",
        },
      });
      await act(async () => {
        editor.dispatchEvent(paste);
      });
      expect(paste.defaultPrevented).toBe(true);
      expect(editor.textContent).toBe(expectedText);
      if (kind === "image" && !disabled) {
        expect(onPasteImages).toHaveBeenCalledExactlyOnceWith([image]);
      } else {
        expect(onPasteImages).not.toHaveBeenCalled();
      }
      if (kind === "text") {
        expect(onChange).toHaveBeenCalledWith(expectedText);
      } else {
        expect(onChange).not.toHaveBeenCalled();
      }
      await act(async () => root.unmount());
    },
  );

  it("removes one contact pill from the draft when clicked", async () => {
    const onChange = vi.fn();

    const { container, root } = await renderIntoDocument(
      <ChatMessageEditor
        disabled={false}
        getCashuTokenMessageInfo={() => null}
        getMintIconUrl={() => ({ url: null })}
        getNpubMessageContactInfo={(npub) => ({
          displayName: npub === FIRST_NPUB ? "Alice" : "Bob",
          isSaved: true,
          npub,
          pictureUrl: null,
        })}
        onCaretChange={() => undefined}
        onChange={onChange}
        onPasteImages={() => undefined}
        onSendShortcut={() => undefined}
        placeholder="Message"
        removeContactLabel="Remove contact from message"
        value={`${FIRST_NPUB} ${SECOND_NPUB} hello`}
      />,
    );

    const firstPill = container.querySelector(".chat-contact-pill");
    expect(firstPill).not.toBeNull();
    await act(async () => {
      firstPill?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith(`${SECOND_NPUB} hello`);
    await act(async () => {
      root.unmount();
    });
  });
});
