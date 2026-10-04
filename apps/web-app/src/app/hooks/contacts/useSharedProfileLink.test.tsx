import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { createId } from "@linky-fit/linksync";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigateTo } from "../../../hooks/useRouting";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY } from "../../../utils/constants";
import { useSharedProfileLink } from "./useSharedProfileLink";

vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: vi.fn(),
}));
vi.mock("../../../hooks/useRouting", () => ({ navigateTo: vi.fn() }));

type Params = Parameters<typeof useSharedProfileLink>[0];

const peerNpub = encodeNpub(makeIdentity().pubkey);
const ownNpub = encodeNpub(makeIdentity().pubkey);
const contactId = createId<"Contact">();

const makeParams = (overrides: Partial<Params> = {}): Params => ({
  accountHydrated: true,
  contacts: [],
  currentNpub: ownNpub,
  saveNpubContact: vi.fn((npub: string) => ({
    contact: { id: contactId, npub },
    created: true,
    npub,
  })),
  setChatDraft: vi.fn(),
  t: (key) => key,
  ...overrides,
});

const Probe = (params: Params) => {
  useSharedProfileLink(params);
  return null;
};

const openHashLink = async (hash: string) => {
  await act(async () => {
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "#wallet");
  vi.mocked(navigateTo).mockClear();
});
afterEach(() => localStorage.clear());

describe("opening a shared profile link", () => {
  it("saves the peer and opens the conversation once its row is read back", async () => {
    const params = makeParams();
    const view = await renderIntoDocument(<Probe {...params} />);
    await openHashLink(`#add/${peerNpub.toUpperCase()}`);

    expect(params.saveNpubContact).toHaveBeenCalledWith(peerNpub);
    expect(params.setChatDraft).toHaveBeenCalledWith("sharedProfileGreeting");
    expect(window.location.hash).toBe("#contacts");
    expect(navigateTo).not.toHaveBeenCalled();

    await view.rerender(<Probe {...params} contacts={[{ id: contactId }]} />);
    expect(navigateTo).toHaveBeenCalledWith({ route: "chat", id: contactId });
    expect(localStorage.getItem(PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY)).toBe(
      null,
    );
    await view.unmount();
  });

  it("waits for hydration, so a restored account finds the contact it has", async () => {
    localStorage.setItem(PENDING_SHARED_PROFILE_NPUB_STORAGE_KEY, peerNpub);
    const params = makeParams({ accountHydrated: false });
    const view = await renderIntoDocument(<Probe {...params} />);
    expect(params.saveNpubContact).not.toHaveBeenCalled();

    await view.rerender(<Probe {...params} accountHydrated />);
    expect(params.saveNpubContact).toHaveBeenCalledWith(peerNpub);
    await view.unmount();
  });

  it("drafts no greeting for an existing contact", async () => {
    const params = makeParams({
      contacts: [{ id: contactId }],
      saveNpubContact: vi.fn((npub: string) => ({
        contact: { id: contactId, npub },
        created: false,
        npub,
      })),
    });
    const view = await renderIntoDocument(<Probe {...params} />);
    await openHashLink(`#add/${peerNpub}`);

    expect(params.setChatDraft).not.toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith({ route: "chat", id: contactId });
    await view.unmount();
  });

  it("opens the profile for the user's own link", async () => {
    const params = makeParams();
    const view = await renderIntoDocument(<Probe {...params} />);
    await openHashLink(`#add/${ownNpub}`);

    expect(params.saveNpubContact).not.toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith({ route: "profile" });
    await view.unmount();
  });
});
