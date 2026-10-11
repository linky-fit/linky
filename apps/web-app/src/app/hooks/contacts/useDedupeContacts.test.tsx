import {
  createId,
  makeContactsRepository,
  NonEmptyString1000,
} from "@linky-fit/linksync";
import { RegistryContext } from "@linky-fit/linkstr-react";
import { Effect } from "effect";
import { act, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { makeTestAppRegistry } from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useDedupeContacts } from "./useDedupeContacts";

const pushToast = vi.hoisted(() => vi.fn<(message: string) => void>());
vi.mock("../shell", async () =>
  (await import("../../../testUtils/shellHooks")).shellHooksMock({
    pushToast: (message) => pushToast(message),
  }),
);

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));

const text = NonEmptyString1000.orThrow;
const SHARED_ADDRESS = text("shared@pay.test");
const CAROL_NPUB = text(
  "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m",
);

describe("useDedupeContacts", () => {
  it("merges contacts by npub and never by a shared lightning address", async () => {
    const { store } = makeTestLinkyStore();
    openLinkyStore.mockResolvedValue(store);
    const contacts = makeContactsRepository(store);
    const bob = createId<"Contact">();
    const bobby = createId<"Contact">();
    const carol = createId<"Contact">();
    const carolAgain = createId<"Contact">();
    for (const row of [
      { id: bob, name: text("Bob"), lnAddress: SHARED_ADDRESS },
      { id: bobby, name: text("Bobby"), lnAddress: SHARED_ADDRESS },
      {
        id: carol,
        name: text("Carol"),
        npub: CAROL_NPUB,
        lnAddress: SHARED_ADDRESS,
      },
      { id: carolAgain, npub: CAROL_NPUB },
    ])
      await Effect.runPromise(contacts.insert(row));

    const dedupe: { current: (() => Promise<void>) | null } = { current: null };
    const Probe = () => {
      const { dedupeContacts } = useDedupeContacts();
      useEffect(() => {
        dedupe.current = dedupeContacts;
      }, [dedupeContacts]);
      return null;
    };
    const view = await renderIntoDocument(
      <RegistryContext.Provider value={makeTestAppRegistry()}>
        <Probe />
      </RegistryContext.Provider>,
    );
    await act(() => dedupe.current?.());

    const remaining = await Effect.runPromise(contacts.all);
    expect(remaining.map((row) => row.id).sort()).toEqual(
      [bob, bobby, carol].sort(),
    );
    expect(pushToast).toHaveBeenCalledWith("dedupeContactsResult");
    await view.unmount();
  });
});
