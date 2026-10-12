// @vitest-environment jsdom
import { encodeNpub, encodeNsec } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { RegistryContext } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { act, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { contactsRepositoryAtom } from "../../state/session/store";
import { statusAtom } from "../../state/shell/status";
import { useSaveNpubContact } from "./useSaveNpubContact";

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));
vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: vi.fn(),
}));

const me = makeIdentity();
const peer = makeIdentity();

const mountSaver = async () => {
  openLinkyStore.mockResolvedValue(makeTestLinkyStore().store);
  const registry = makeTestAppRegistry({
    session: signedInSession({ nsec: encodeNsec(me.secretKey) }),
  });
  const contacts = await Effect.runPromise(
    AtomRegistry.getResult(registry, contactsRepositoryAtom),
  );
  let save: ReturnType<typeof useSaveNpubContact> | undefined;
  const Probe = () => {
    const callback = useSaveNpubContact();
    useLayoutEffect(() => {
      save = callback;
    }, [callback]);
    return null;
  };
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  await act(async () => {});
  return {
    ...view,
    contacts,
    registry,
    save: (npub: string) => {
      if (!save) throw new Error("Not mounted");
      return save(npub);
    },
  };
};

describe("useSaveNpubContact", () => {
  it("saves a peer and answers with its row at once", async () => {
    const view = await mountSaver();
    const npub = encodeNpub(peer.pubkey);
    await act(async () => {
      expect(view.save(npub)).toMatchObject({ created: true, npub });
    });
    await vi.waitFor(async () =>
      expect(
        (await Effect.runPromise(view.contacts.all)).map((row) => row.npub),
      ).toEqual([npub]),
    );
    await view.unmount();
  });

  it("refuses the user's own npub with a status instead of a row", async () => {
    const view = await mountSaver();
    await act(async () => {
      expect(view.save(encodeNpub(me.pubkey).toUpperCase())).toBeNull();
    });
    expect(view.registry.get(statusAtom)).toBe(
      "This is your own profile. It can't be saved as a contact.",
    );
    expect(await Effect.runPromise(view.contacts.all)).toEqual([]);
    await view.unmount();
  });
});
