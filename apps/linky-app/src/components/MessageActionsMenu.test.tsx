import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { MessageActionsMenu } from "./MessageActionsMenu";

// Rendering the real list of a few hundred emojis in jsdom is slow enough to
// time out under load; the picker's behaviour is the same with a short one.
vi.mock("../app/lib/reactionEmojis", () => ({
  QUICK_REACTION_EMOJIS: ["❤️", "👍"],
  REACTION_EMOJI_GROUPS: [
    { id: "smileysAndPeople", icon: "Smile", emojis: ["😀", "😂", "😍"] },
    { id: "flags", icon: "Flag", emojis: ["🏁", "🇨🇿"] },
  ],
}));

const defaultLabels = {
  copy: "Copy",
  delete: "Delete",
  deleted: "Message deleted",
  edit: "Edit",
  emojiGroups: {
    smileysAndPeople: "Smileys & People",
    animalsAndNature: "Animals & Nature",
    foodAndDrink: "Food & Drink",
    activities: "Activities",
    travelAndPlaces: "Travel & Places",
    objects: "Objects",
    symbols: "Symbols",
    flags: "Flags",
  },
  menu: "Message actions",
  moreEmojis: "More emojis",
  react: "React",
  reply: "Reply",
  save: "Save",
  share: "Share",
};

type MenuProps = Parameters<typeof MessageActionsMenu>[0];

const renderMenu = async (overrides: Partial<MenuProps> = {}) => {
  const { root } = await renderIntoDocument(
    <MessageActionsMenu
      canCopy={true}
      canDelete={true}
      canEdit={false}
      canReplyOrReact={true}
      imageActions={null}
      isOpen={true}
      labels={defaultLabels}
      onClose={vi.fn()}
      onCopy={vi.fn()}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onReact={vi.fn()}
      onReply={vi.fn()}
      {...overrides}
    />,
  );

  return root;
};

const menuItemLabels = (): string[] =>
  Array.from(
    document.body.querySelectorAll('[data-testid="message-action"]'),
  ).map((item) => item.textContent ?? "");

describe("MessageActionsMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers share and save instead of copy for image messages", async () => {
    const onSave = vi.fn();
    const onShare = vi.fn();
    const root = await renderMenu({
      canCopy: false,
      imageActions: { canShare: true, onSave, onShare },
    });

    expect(menuItemLabels()).toEqual(["Reply", "Share", "Save", "Delete"]);

    const [, shareItem, saveItem] = Array.from(
      document.body.querySelectorAll('[data-testid="message-action"]'),
    );
    await act(async () => {
      shareItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      saveItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("expands the quick reactions to the tabbed catalog from the plus button", async () => {
    const onReact = vi.fn();
    const root = await renderMenu({ onReact });
    const emojiLabels = (groupLabel: string) =>
      Array.from(
        Array.from(document.body.querySelectorAll('[role="group"]'))
          .find((group) => group.getAttribute("aria-label") === groupLabel)
          ?.querySelectorAll("[aria-label]") ?? [],
      ).map((cell) => cell.getAttribute("aria-label"));
    const moreButton = () =>
      document.body.querySelector('[aria-label="More emojis"]');

    expect(emojiLabels("React")).toEqual(["❤️", "👍", "More emojis"]);

    await act(async () => {
      moreButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(moreButton()).toBeNull();
    expect(emojiLabels("React: Smileys & People")).toEqual(["😀", "😂", "😍"]);
    expect(document.body.querySelector('[role="tablist"]')).not.toBeNull();

    await act(async () => {
      document.body
        .querySelector('[role="tab"][aria-label="Flags"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(emojiLabels("React: Flags")).toEqual(["🏁", "🇨🇿"]);

    await act(async () => {
      Array.from(document.body.querySelectorAll("[aria-label]"))
        .find((cell) => cell.getAttribute("aria-label") === "🇨🇿")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onReact).toHaveBeenCalledWith("🇨🇿");

    await act(async () => {
      root.unmount();
    });
  });

  it("deletes from the last item and hides it for messages without an id", async () => {
    const onDelete = vi.fn();
    const root = await renderMenu({ onDelete });

    expect(menuItemLabels()).toEqual(["Reply", "Copy", "Delete"]);
    const deleteItem = Array.from(
      document.body.querySelectorAll('[data-testid="message-action"]'),
    ).at(-1);
    await act(async () => {
      deleteItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.unmount();
    });

    const withoutId = await renderMenu({ canDelete: false });
    expect(menuItemLabels()).toEqual(["Reply", "Copy"]);
    await act(async () => {
      withoutId.unmount();
    });
  });

  it("hides the share item when the device cannot share files", async () => {
    const root = await renderMenu({
      canCopy: false,
      imageActions: { canShare: false, onSave: vi.fn(), onShare: vi.fn() },
    });

    expect(menuItemLabels()).toEqual(["Reply", "Save", "Delete"]);

    await act(async () => {
      root.unmount();
    });
  });
});
