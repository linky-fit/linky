import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ContactsChecklist } from "./ContactsChecklist";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ContactsChecklist", () => {
  it("shows only the first incomplete task", async () => {
    const onShowHow = vi.fn();

    const { container, root } = await renderIntoDocument(
      <ContactsChecklist
        contactsOnboardingCelebrating={false}
        dismissContactsOnboarding={() => undefined}
        onShowHow={onShowHow}
        progressPercent={20}
        t={(key) => key}
        tasks={[
          { done: true, key: "done", label: "Completed task" },
          { done: false, key: "next", label: "Next task" },
          { done: false, key: "later", label: "Later task" },
        ]}
        tasksCompleted={1}
        tasksTotal={3}
      />,
    );

    const items = container.querySelectorAll('[role="listitem"]');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("Next task");
    expect(container.textContent).not.toContain("Completed task");
    expect(container.textContent).not.toContain("Later task");

    await act(async () => {
      items[0]
        ?.querySelector("button")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onShowHow).toHaveBeenCalledWith("next");

    await act(async () => root.unmount());
  });
});
