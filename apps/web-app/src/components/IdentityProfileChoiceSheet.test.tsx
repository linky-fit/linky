import { decodeNpub, ProfileMetadata } from "@linky-fit/linkstr";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PendingIdentitySwitch } from "../app/hooks/useProfileAuthDomain";
import type { IdentityProfileSource } from "../app/lib/keySwitchProfile";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { IdentityProfileChoiceSheet } from "./IdentityProfileChoiceSheet";

const NPUB = "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z";
const pubkey = decodeNpub(NPUB);
if (!pubkey) throw new Error("test npub must decode");

const t = (key: string) => key;

const renderSheet = (
  check: PendingIdentitySwitch["check"],
  onAnswer = vi.fn<(source: IdentityProfileSource | null) => Promise<void>>(
    async () => {},
  ),
) =>
  renderIntoDocument(
    <IdentityProfileChoiceSheet
      onAnswer={onAnswer}
      pending={{
        check,
        lightningAddress: "bob@linky.fit",
        linkyProfile: new ProfileMetadata({ name: "Alice" }),
        npub: NPUB,
        nsec: "nsec1test",
        pubkey,
      }}
      t={t}
    />,
  );

const press = async (label: string) => {
  const target = Array.from(
    document.body.querySelectorAll('[role="button"], [role="radio"], button'),
  ).find((element) => element.textContent === label);
  if (!target) throw new Error(`No control labeled ${label}`);
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const previewText = () =>
  document.body.querySelector('[data-testid="identity-profile-preview"]')
    ?.textContent ?? "";

describe("IdentityProfileChoiceSheet", () => {
  it("previews the profile each choice publishes and confirms the shown one", async () => {
    const onAnswer = vi.fn<
      (source: IdentityProfileSource | null) => Promise<void>
    >(async () => {});
    const view = await renderSheet(
      {
        kind: "found",
        metadata: new ProfileMetadata({ name: "Bob", about: "Bob's bio" }),
      },
      onAnswer,
    );

    expect(previewText()).toContain("Alice");
    expect(previewText()).toContain("bob@linky.fit");
    await press("identityProfileUseNostr");
    expect(previewText()).toContain("Bob");
    expect(previewText()).toContain("Bob's bio");
    expect(previewText()).toContain("bob@linky.fit");

    await press("identityProfileConfirm");
    expect(onAnswer).toHaveBeenLastCalledWith("nostr");
    await view.unmount();
  });

  it("offers only the Linky profile when the identity could not be checked", async () => {
    const onAnswer = vi.fn<
      (source: IdentityProfileSource | null) => Promise<void>
    >(async () => {});
    const view = await renderSheet({ kind: "unchecked" }, onAnswer);

    expect(document.body.textContent).toContain(
      "identityProfileChoiceUnchecked",
    );
    expect(document.body.querySelector('[role="radiogroup"]')).toBeNull();
    await press("identityProfileCancel");
    expect(onAnswer).toHaveBeenLastCalledWith(null);
    await view.unmount();
  });
});
