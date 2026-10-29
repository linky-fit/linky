import { UIProvider } from "@linky-fit/ui";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, type Mock } from "vitest";
import type { EditedProfile, OperatorProfile } from "../domain/profile";
import { SettingsScreen } from "./SettingsScreen";

const state: {
  profile: OperatorProfile | null;
  save: Mock<(profile: EditedProfile) => Promise<boolean>>;
  setPicture: Mock<(image: null) => Promise<boolean>>;
} = vi.hoisted(() => ({
  profile: null,
  save: vi.fn<(profile: EditedProfile) => Promise<boolean>>(),
  setPicture: vi.fn<(image: null) => Promise<boolean>>(),
}));

vi.mock("../services/react", () => ({
  useProfile: () => state.profile,
  useDevice: () => ({ resetDevice: vi.fn() }),
  useAppServices: () => ({
    account: { npub: "npub1operator" },
    config: {
      network: "regtest",
      mintUrl: "http://localhost:3338",
      explorerUrl: "http://localhost:3003",
    },
    profile: { save: state.save, setPicture: state.setPicture },
  }),
}));

it.each([
  [true, "Saved and published."],
  [
    false,
    "Saved, but the on-chain config or profile name did not reach a relay; save again to retry.",
  ],
])(
  "keeps publication feedback after the saved profile updates (%s)",
  async (published, message) => {
    state.profile = {
      name: "Transfer desk",
      xpub: "tpubDDfvzhdVV4unsoKt5aE6dcsNsfeWbTgmLZPi8LQDYU2xixrYemMfWJ3BaVneH3u7DBQePdTwhpybaKRU95pi6PMUtLPBJLVQRpzEnjfjZzX",
      feeBasisPoints: 100,
      paused: false,
      description: "",
      amounts: [100000],
      maxReceiveAmount: 1000000,
      minReceiveAmount: 100_000,
      minClientVersion: null,
      watchers: [],
      picture: null,
    };
    let finish: (published: boolean) => void = () => {};
    state.save.mockImplementation((profile) => {
      state.profile = {
        ...profile,
        description: "Saved description",
        picture: null,
      };
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    const render = () =>
      root.render(
        <UIProvider mode="dark">
          <SettingsScreen />
        </UIProvider>,
      );
    try {
      await act(render);
      const save = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Save and publish",
      );
      if (save === undefined) throw new Error("missing save button");
      await act(() => save.click());
      await act(render);
      await act(async () => {
        finish(published);
      });
      expect(container.textContent).toContain(message);
    } finally {
      await act(() => root.unmount());
      container.remove();
    }
  },
);

it("removes the picture without dropping unsaved form edits", async () => {
  state.profile = {
    name: "Transfer desk",
    xpub: "tpubDDfvzhdVV4unsoKt5aE6dcsNsfeWbTgmLZPi8LQDYU2xixrYemMfWJ3BaVneH3u7DBQePdTwhpybaKRU95pi6PMUtLPBJLVQRpzEnjfjZzX",
    feeBasisPoints: 100,
    paused: false,
    description: "",
    amounts: [100000],
    maxReceiveAmount: 1000000,
    minReceiveAmount: 100_000,
    minClientVersion: null,
    watchers: [],
    picture: "https://blossom.primal.net/ab12.webp",
  };
  state.setPicture.mockImplementation(async () => {
    if (state.profile !== null)
      state.profile = { ...state.profile, picture: null };
    return true;
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const render = () =>
    root.render(
      <UIProvider mode="dark">
        <SettingsScreen />
      </UIProvider>,
    );
  const byTestId = (testId: string) => {
    const element = document.querySelector<HTMLElement>(
      `[data-testid="${testId}"]`,
    );
    if (element === null) throw new Error(`no ${testId}`);
    return element;
  };
  const nameInput = () => {
    const input = Array.from(container.querySelectorAll("input")).find(
      (candidate) => candidate.value.startsWith("Transfer desk"),
    );
    if (input === undefined) throw new Error("missing name field");
    return input;
  };
  try {
    await act(render);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(nameInput(), "Transfer desk edited");
      nameInput().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => byTestId("settings-picture").click());
    await act(() => byTestId("profile-picture-remove").click());
    await act(render);
    expect(state.setPicture).toHaveBeenCalledWith(null);
    expect(
      document.querySelector('[data-testid="profile-picture-dialog"]'),
    ).toBeNull();
    expect(nameInput().value).toBe("Transfer desk edited");
  } finally {
    await act(() => root.unmount());
    container.remove();
  }
});
