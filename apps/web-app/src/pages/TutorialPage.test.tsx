import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { TutorialPage } from "./TutorialPage";

const { startContactsGuide } = vi.hoisted(() => ({
  startContactsGuide: vi.fn(),
}));

vi.mock("../app/hooks/guide/useContactsGuideControls", () => ({
  useStartContactsGuide: () => startContactsGuide,
}));
vi.mock("../app/hooks/guide/useContactsOnboarding", () => ({
  useContactsOnboarding: () => ({
    contactsOnboardingTasks: {
      done: 1,
      percent: 50,
      tasks: [
        { done: true, key: "add_contact", label: "Add contact" },
        { done: false, key: "proxy_payment", label: "Set up proxy payments" },
      ],
      total: 2,
    },
  }),
}));
vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);

describe("TutorialPage", () => {
  it("replays a task's guide from its Show how button, done or not", async () => {
    const { container, unmount } = await renderIntoDocument(<TutorialPage />);

    const row = container.querySelector(
      '[data-testid="tutorial-task-proxy_payment"]',
    );
    expect(row?.textContent).toContain("Set up proxy payments");
    await act(async () => {
      row?.querySelector("button")?.click();
    });
    expect(startContactsGuide).toHaveBeenCalledWith("proxy_payment", false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="tutorial-task-add_contact"] button',
        )
        ?.click();
    });
    expect(startContactsGuide).toHaveBeenCalledWith("add_contact", true);
    unmount();
  });
});
