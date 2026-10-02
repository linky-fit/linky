import { act, createRef, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ChatComposer } from "./ChatPage";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    formatDisplayedAmountText: (amountSat: number) => `${amountSat} sat`,
  }),
}));

type Props = ComponentProps<typeof ChatComposer>;

const setup = async (overrides: Partial<Props> = {}) => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  let props: Props = {
    canPayThisContact: false,
    canRequestThisContact: false,
    canStartPay: false,
    addChatAttachments: vi.fn(),
    cashuIsBusy: false,
    chatAttachments: [],
    chatDraft: "First message",
    chatSendIsBusy: false,
    composeContainerRef: createRef<HTMLDivElement>(),
    composeInputRef: createRef<HTMLDivElement>(),
    editContext: null,
    getCashuTokenMessageInfo: () => null,
    getMintIconUrl: () => ({
      failed: false,
      host: null,
      origin: null,
      url: null,
    }),
    getNpubMessageContactInfo: () => null,
    hasUnknownPubkeyHex: true,
    isFeedbackContact: false,
    mentionContacts: [],
    npub: null,
    onCancelEdit: vi.fn(),
    onCancelReply: vi.fn(),
    openContactPay: vi.fn(),
    replyContext: null,
    replyPreviewText: "",
    selectedContact: { id: "contact" },
    sendChatImage: vi.fn(async () => true),
    sendChatMessage: vi.fn(async () => {}),
    removeChatAttachment: vi.fn(),
    setChatDraft: vi.fn(),
    t: (key) => key,
    ...overrides,
  };
  const rendered = await renderIntoDocument(<ChatComposer {...props} />);
  const editor =
    rendered.container.querySelector<HTMLDivElement>("[role=textbox]");
  if (!editor) throw new Error("Missing editor");
  return {
    ...rendered,
    editor,
    props,
    update: async (next: Partial<Props>) => {
      props = { ...props, ...next };
      await rendered.rerender(<ChatComposer {...props} />);
    },
    type: async (text: string) => {
      await act(async () => {
        editor.textContent = text;
        editor.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText" }),
        );
      });
    },
    sendButton: () =>
      rendered.container.querySelector<HTMLButtonElement>(
        '[data-guide="chat-send"]',
      ),
  };
};

describe("ChatComposer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([true, false])(
    "preserves the next draft when the first send clears its draft, busy=%s",
    async (stillBusy) => {
      const composer = await setup();
      await act(async () => composer.sendButton()?.click());
      expect(composer.props.sendChatMessage).toHaveBeenCalledOnce();
      await composer.update({ chatSendIsBusy: true });
      await composer.type("Second message");
      expect(composer.props.setChatDraft).not.toHaveBeenCalled();
      expect(composer.sendButton()?.disabled).toBe(true);

      await composer.update({ chatDraft: "", chatSendIsBusy: stillBusy });
      expect(composer.editor.textContent).toBe("Second message");
      await composer.update({ chatSendIsBusy: false });
      expect(composer.editor.textContent).toBe("Second message");
      expect(composer.sendButton()?.disabled).toBe(false);
      await act(async () => composer.sendButton()?.click());
      expect(composer.props.setChatDraft).toHaveBeenCalledWith(
        "Second message",
      );
      await composer.update({ chatDraft: "Second message" });
      expect(composer.props.sendChatMessage).toHaveBeenCalledTimes(2);
      await composer.unmount();
    },
  );

  it("clears the sent draft if it has not changed", async () => {
    const composer = await setup({ chatSendIsBusy: true });
    await composer.update({ chatDraft: "" });
    expect(composer.editor.textContent).toBe("");
    expect(composer.sendButton()).toBeNull();
    await composer.unmount();
  });

  it("applies an external draft and clears a cancelled edit", async () => {
    const composer = await setup();
    await composer.type("Unsent text");
    await composer.update({
      chatDraft: "Original message",
      editContext: {
        messageId: "message",
        originalContent: "Original message",
        rumorId: "rumor",
      },
    });
    expect(composer.editor.textContent).toBe("Original message");
    await composer.type("Edited text");
    await composer.update({ chatDraft: "", editContext: null });
    expect(composer.editor.textContent).toBe("");
    await composer.unmount();
  });
});
