import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { NostrIdentityPage } from "./NostrIdentityPage";

const {
  copyNostrKeys,
  copyText,
  pushToast,
  removeAttachedIdentity,
  requestPasteNostrKeys,
  settings,
  switchToAttachedIdentity,
  switchToDefaultIdentity,
} = vi.hoisted(() => ({
  copyNostrKeys: vi.fn(async () => {}),
  copyText: vi.fn(async () => {}),
  pushToast: vi.fn(),
  removeAttachedIdentity: vi.fn(async () => {}),
  requestPasteNostrKeys: vi.fn(async () => {}),
  settings: ((): {
    attachedIdentityNpub: string | null;
    canSwitchToDefaultIdentity: boolean;
    derivedIdentityNpub: string | null;
    nostrIdentitySource: "custom" | "derived";
  } => ({
    attachedIdentityNpub: null,
    canSwitchToDefaultIdentity: false,
    derivedIdentityNpub: null,
    nostrIdentitySource: "derived",
  }))(),
  switchToAttachedIdentity: vi.fn(async () => {}),
  switchToDefaultIdentity: vi.fn(async () => {}),
}));

vi.mock("@linky-fit/linkstr-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === currentNpubAtom
      ? "npub1me"
      : atom === currentNsecAtom
        ? "nsec1me"
        : null,
  useLinkstrCommands: () => ({ fetchProfile: vi.fn() }),
}));
vi.mock("../app/state/session/session", () => ({
  currentNpubAtom: { id: "currentNpub" },
  currentNsecAtom: { id: "currentNsec" },
}));
import { currentNpubAtom, currentNsecAtom } from "../app/state/session/session";

vi.mock("../app/hooks/useLinkstrProfileSync", () => ({
  fetchAndCacheProfile: async () => null,
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    copyText,
    pushToast,
  }),
);
vi.mock("../app/hooks/profile/useEffectiveProfile", () => ({
  useEffectiveProfile: () => ({
    effectiveMyLightningAddress: "me@linky.fit",
    effectiveProfileName: "Me Myself",
    effectiveProfilePicture: null,
  }),
}));

vi.mock("../app/hooks/settings/useIdentitySettings", () => ({
  useCopyNostrKeys: () => copyNostrKeys,
  useIdentitySettings: () => ({
    answerPendingIdentitySwitch: vi.fn(),
    pendingIdentitySwitch: null,
    removeAttachedIdentity,
    requestPasteNostrKeys,
    seedMnemonic: "academic acid acne",
    switchToAttachedIdentity,
    switchToDefaultIdentity,
    ...settings,
  }),
}));

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  settings.attachedIdentityNpub = null;
  settings.canSwitchToDefaultIdentity = false;
  settings.derivedIdentityNpub = null;
  settings.nostrIdentitySource = "derived";
});

const byTestId = (container: HTMLElement, testID: string) => {
  const element = container.querySelector<HTMLElement>(
    `[data-testid="${testID}"]`,
  );
  if (!element) throw new Error(`${testID} missing`);
  return element;
};
const buttonNamed = (root: HTMLElement, text: string) => {
  const button = Array.from(root.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`button ${text} missing`);
  return button;
};

it("marks the derived identity in use, copies the npub from its label and the nsec on the second press", async () => {
  const { container, unmount } = await renderIntoDocument(
    <NostrIdentityPage />,
  );
  expect(container.textContent).toContain("nostrIdentityUsingDerived");
  const current = byTestId(container, "nostr-identity-current");
  expect(current.textContent).toContain("Me Myself");
  expect(current.textContent).toContain("nostrIdentityInUse");

  await act(async () => buttonNamed(current, "npub1me").click());
  expect(copyText).toHaveBeenCalledExactlyOnceWith("npub1me");
  await act(async () => buttonNamed(current, "me@linky.fit").click());
  expect(copyText).toHaveBeenLastCalledWith("me@linky.fit");

  await act(async () => byTestId(container, "copy-nostr-keys").click());
  expect(pushToast).toHaveBeenCalledExactlyOnceWith("sensitiveActionArmedHint");
  expect(copyNostrKeys).not.toHaveBeenCalled();
  await act(async () => byTestId(container, "copy-nostr-keys").click());
  expect(copyNostrKeys).toHaveBeenCalledOnce();

  // Nothing attached yet: pasting starts right away, without a confirmation.
  await act(async () => byTestId(container, "paste-nostr-keys").click());
  expect(requestPasteNostrKeys).toHaveBeenCalledOnce();
  await unmount();
});

it("offers the attached identity for use or removal while the derived one is active", async () => {
  settings.attachedIdentityNpub = "npub1attached";
  const { container, unmount } = await renderIntoDocument(
    <NostrIdentityPage />,
  );
  const other = byTestId(container, "nostr-identity-other");
  expect(other.textContent).toContain("nostrIdentityCustomTitle");
  expect(other.textContent).toContain("npub1attac");
  // Without a published profile the identity has its Linky npub address.
  expect(other.textContent).toContain("@linky.fit");
  expect(
    container.querySelector('[data-testid="paste-nostr-keys"]'),
  ).toBeNull();

  await act(async () =>
    byTestId(container, "switch-to-attached-identity").click(),
  );
  expect(switchToAttachedIdentity).toHaveBeenCalledOnce();

  await act(async () =>
    byTestId(container, "remove-attached-identity").click(),
  );
  expect(pushToast).toHaveBeenCalledExactlyOnceWith("deleteArmedHint");
  await act(async () =>
    byTestId(container, "remove-attached-identity").click(),
  );
  expect(removeAttachedIdentity).toHaveBeenCalledOnce();
  await unmount();
});

it("with a custom identity shows the derived one with its Linky defaults and switches back", async () => {
  settings.canSwitchToDefaultIdentity = true;
  settings.derivedIdentityNpub = "npub1derived";
  settings.nostrIdentitySource = "custom";
  const { container, unmount } = await renderIntoDocument(
    <NostrIdentityPage />,
  );
  expect(container.textContent).toContain("nostrIdentityUsingCustom");

  const other = byTestId(container, "nostr-identity-other");
  expect(other.textContent).toContain("nostrIdentityDerivedTitle");
  expect(other.textContent).toContain("npub1deriv");
  expect(other.querySelectorAll("img").length).toBeGreaterThan(0);

  await act(async () =>
    byTestId(container, "switch-to-derived-identity").click(),
  );
  expect(pushToast).toHaveBeenCalledExactlyOnceWith("defaultIdentityArmedHint");
  await act(async () =>
    byTestId(container, "switch-to-derived-identity").click(),
  );
  expect(switchToDefaultIdentity).toHaveBeenCalledOnce();
  await unmount();
});
