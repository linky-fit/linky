import { RegistryContext } from "@linky-fit/linkstr-react";
import { AtomRegistry } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaidOverlayContact } from "../app/lib/paidOverlay";
import { contactsAtom } from "../app/state/contacts/readModel";
import type { ContactRowLike } from "../app/types/appTypes";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { PaidOverlay } from "./PaidOverlay";

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);

afterEach(() => {
  document.body.innerHTML = "";
});

const shopNpub = "npub1shop";

const renderOverlay = (
  contact: PaidOverlayContact,
  savedContacts: readonly ContactRowLike[],
) =>
  renderIntoDocument(
    <RegistryContext.Provider
      value={AtomRegistry.make({
        initialValues: [[contactsAtom, savedContacts]],
      })}
    >
      <PaidOverlay
        details={{ direction: "out", amountSat: 50, contact }}
        paidOverlayTitle={null}
        phase="done"
        t={(key) => key}
      />
    </RegistryContext.Provider>,
  );

const avatarName = () =>
  document.body.querySelector('[role="status"] [role="img"]')?.ariaLabel;

describe("PaidOverlay", () => {
  it("names the saved contact as it is now, not as it was when the payment started", async () => {
    const { unmount } = await renderOverlay(
      { name: "Zdeněk", npub: shopNpub },
      [{ id: "shop", name: "Kavárna U Fazole", npub: shopNpub }],
    );

    expect(avatarName()).toBe("Kavárna U Fazole");
    expect(document.body.textContent).not.toContain("Zdeněk");
    await unmount();
  });

  it("keeps the payment's name for a payee that is not saved", async () => {
    const { unmount } = await renderOverlay(
      { name: "Zdeněk", npub: shopNpub },
      [],
    );

    expect(avatarName()).toBe("Zdeněk");
    await unmount();
  });
});
