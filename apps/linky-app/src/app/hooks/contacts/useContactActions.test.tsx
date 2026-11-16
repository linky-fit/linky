// @vitest-environment jsdom
import { encodeNpub } from "@linky-fit/linkstr";
import { createId, type ContactId } from "@linky-fit/linksync";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { AsyncResult, Atom } from "effect/reactivity";
import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { readBlockList } from "../../lib/blockList";
import type { PushToastOptions } from "../../state/shell/toasts";

interface TestContact {
  id: ContactId;
  npub?: string;
  archivedAtSec?: number | undefined;
}

const mocks = vi.hoisted(() => {
  const contacts = new Array<TestContact>();
  const setDeleted = (id: ContactId, archivedAtSec: number | undefined) => {
    const index = contacts.findIndex((contact) => contact.id === id);
    const contact = contacts[index];
    if (contact) contacts[index] = { ...contact, archivedAtSec };
  };
  return {
    contacts,
    setDeleted,
    deleteContact: vi.fn(async (id: ContactId) => {
      setDeleted(id, 100);
      return { ok: true as const };
    }),
    restoreContact: vi.fn(async (id: ContactId) => {
      setDeleted(id, undefined);
      return { ok: true as const };
    }),
    pushToast: vi.fn<(message: string, options?: PushToastOptions) => void>(),
    syncMuteList: vi.fn(async () => true),
  };
});

vi.mock("../shell", async () =>
  (await import("../../../testUtils/shellHooks")).shellHooksMock({
    pushToast: (message, options) => mocks.pushToast(message, options),
  }),
);
vi.mock("../../../hooks/useRouting", () => ({ navigateTo: vi.fn() }));
vi.mock("./useDisplayContacts", () => ({
  useContacts: () => mocks.contacts,
}));
vi.mock("../../state/contacts/readModel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/contacts/readModel")>()),
  contactsAtom: Atom.make(() => mocks.contacts),
}));
vi.mock("../../state/contacts/commands", () => ({
  contactsCommandsAtom: Atom.make(
    AsyncResult.success({
      deleteContact: mocks.deleteContact,
      restoreContact: mocks.restoreContact,
    }),
  ),
}));
vi.mock("../../state/contacts/muteList", () => ({
  syncMuteListAtom: Atom.make(() => mocks.syncMuteList),
}));
vi.mock("../../state/session/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/session/session")>()),
  currentNsecAtom: Atom.make("nsec1test"),
}));

import { useAtomValue } from "@linky-fit/linkstr-react";
import { navigateTo } from "../../../hooks/useRouting";
import { unknownNamesAtom } from "../../state/contacts/chatContacts";
import {
  useBlockEditedContact,
  useDeleteContact,
  useOpenContactCandidate,
} from "./useContactActions";

const peer = makeIdentity();
const withNpub = { id: createId<"Contact">(), npub: encodeNpub(peer.pubkey) };
const lightningOnly = { id: createId<"Contact">() };

const lastToast = () => {
  const [message, options] = mocks.pushToast.mock.calls.at(-1) ?? [];
  return {
    message,
    press: (label: string) =>
      options?.actions?.find((action) => action.label === label)?.onClick(),
    labels: options?.actions?.map((action) => action.label),
  };
};

const renderHooks = async (editedId: ContactId | null = null) => {
  const hooks: {
    deleteContact?: ReturnType<typeof useDeleteContact>;
    blockEdited?: ReturnType<typeof useBlockEditedContact>;
  } = {};
  const Probe = () => {
    const deleteContact = useDeleteContact();
    const blockEdited = useBlockEditedContact(editedId);
    React.useEffect(() => {
      hooks.deleteContact = deleteContact;
      hooks.blockEdited = blockEdited;
    });
    return null;
  };
  const view = await renderIntoDocument(
    <React.Suspense>
      <Probe />
    </React.Suspense>,
  );
  return { hooks, unmount: view.unmount };
};

describe("contact block actions", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.contacts.splice(0, mocks.contacts.length, withNpub, lightningOnly);
    vi.clearAllMocks();
  });

  it("offers Block after deleting a contact with an npub, and Undo alone otherwise", async () => {
    const { hooks, unmount } = await renderHooks();
    await act(() => hooks.deleteContact!(lightningOnly.id));
    expect(lastToast().labels).toEqual(["undo"]);

    await act(() => hooks.deleteContact!(withNpub.id));
    expect(lastToast()).toMatchObject({
      message: "contactDeleted",
      labels: ["undo", "blockContact"],
    });
    await unmount();
  });

  it("blocks from the deletion toast without deleting again, and its undo only unblocks", async () => {
    const { hooks, unmount } = await renderHooks();
    await act(() => hooks.deleteContact!(withNpub.id));
    await act(async () => lastToast().press("blockContact"));

    expect(mocks.deleteContact).toHaveBeenCalledTimes(1);
    expect(readBlockList()).toEqual([peer.pubkey]);
    expect(mocks.syncMuteList).toHaveBeenCalled();
    expect(lastToast().message).toBe("contactBlocked");

    await act(async () => lastToast().press("undo"));
    expect(readBlockList()).toEqual([]);
    expect(mocks.restoreContact).not.toHaveBeenCalled();
    await unmount();
  });

  it("deletes again when a message restored the contact before Block in the toast", async () => {
    const { hooks, unmount } = await renderHooks();
    await act(() => hooks.deleteContact!(withNpub.id));
    mocks.setDeleted(withNpub.id, undefined);
    await act(async () => lastToast().press("blockContact"));

    expect(mocks.deleteContact).toHaveBeenCalledTimes(2);
    await act(async () => lastToast().press("undo"));
    expect(mocks.restoreContact).toHaveBeenCalledWith(withNpub.id);
    await unmount();
  });

  it("blocks and deletes the edited contact, and its undo restores both", async () => {
    const { hooks, unmount } = await renderHooks(withNpub.id);
    await act(async () => hooks.blockEdited!());

    expect(mocks.deleteContact).toHaveBeenCalledWith(withNpub.id);
    expect(readBlockList()).toEqual([peer.pubkey]);

    await act(async () => lastToast().press("undo"));
    expect(readBlockList()).toEqual([]);
    expect(mocks.restoreContact).toHaveBeenCalledWith(withNpub.id);
    await unmount();
  });

  it("has nothing to block on a contact without an npub", async () => {
    const { hooks, unmount } = await renderHooks(lightningOnly.id);
    expect(hooks.blockEdited).toBeNull();
    await unmount();
  });
});

describe("useOpenContactCandidate", () => {
  const stranger = makeIdentity();
  const candidate = (npub: string) => ({
    isExactMatch: true,
    lnAddress: "",
    name: "Stranger",
    nip05: "",
    nip05Verified: false,
    npub,
    pictureUrl: null,
    query: npub,
    usesLinky: false,
  });

  beforeEach(() => {
    mocks.contacts.splice(0, mocks.contacts.length, withNpub);
    vi.clearAllMocks();
  });

  const renderOpen = async () => {
    const seen: {
      open?: ReturnType<typeof useOpenContactCandidate>;
      names?: Readonly<Record<string, string | null>>;
    } = {};
    const Probe = () => {
      const open = useOpenContactCandidate();
      const names = useAtomValue(unknownNamesAtom);
      React.useEffect(() => {
        seen.open = open;
        seen.names = names;
      });
      return null;
    };
    const view = await renderIntoDocument(<Probe />);
    return { seen, unmount: view.unmount };
  };

  it("opens someone who is not a contact as an unknown sender, under their profile name, without saving them", async () => {
    const { seen, unmount } = await renderOpen();
    const npub = encodeNpub(stranger.pubkey);
    await act(async () => seen.open!(candidate(npub)));

    expect(navigateTo).toHaveBeenCalledWith({
      route: "chat",
      id: `unknown:${stranger.pubkey}`,
    });
    expect(seen.names?.[npub]).toBe("Stranger");
    expect(mocks.contacts).toEqual([withNpub]);
    await unmount();
  });

  it("opens a saved contact's own conversation", async () => {
    const { seen, unmount } = await renderOpen();
    await act(async () =>
      seen.open!({
        ...candidate(withNpub.npub),
        existingContactId: withNpub.id,
      }),
    );

    expect(navigateTo).toHaveBeenLastCalledWith({
      route: "chat",
      id: withNpub.id,
    });
    await unmount();
  });
});
