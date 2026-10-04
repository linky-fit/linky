import {
  createId,
  makeContactsRepository,
  makeConversationsRepository,
  NonEmptyString1000,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { act, useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { useContactsDomain } from "./useContactsDomain";

const text = NonEmptyString1000.orThrow;
const SHARED_ADDRESS = text("shared@pay.test");
const CAROL_NPUB = text(
  "npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m",
);

describe("useContactsDomain dedupe", () => {
  it("merges contacts by npub and never by a shared lightning address", async () => {
    const { store } = makeTestLinkyStore();
    const contacts = makeContactsRepository(store);
    const conversations = makeConversationsRepository(store);
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
    const pushToast = vi.fn<(message: string) => void>();
    const Probe = () => {
      const { dedupeContacts } = useContactsDomain({
        accountHydrated: true,
        contacts,
        conversations,
        noGroupFilterValue: "",
        pushToast,
        reassignContactMessages: () => 0,
        route: { kind: "contacts" },
        t: (key) => key,
      });
      useEffect(() => {
        dedupe.current = dedupeContacts;
      }, [dedupeContacts]);
      return null;
    };
    const view = await renderIntoDocument(<Probe />);
    await act(() => dedupe.current?.());

    const remaining = await Effect.runPromise(contacts.all);
    expect(remaining.map((row) => row.id).sort()).toEqual(
      [bob, bobby, carol].sort(),
    );
    expect(pushToast).toHaveBeenCalledWith("dedupeContactsResult");
    await view.unmount();
  });
});
