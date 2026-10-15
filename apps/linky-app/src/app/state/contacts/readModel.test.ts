import { createId, NonEmptyString1000, PositiveInt } from "@linky-fit/linksync";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { serializeContactGroups } from "../../../utils/contactGroups";
import {
  contactsRepositoryAtom,
  conversationsRepositoryAtom,
} from "../session/store";
import { contactGroupsAtom, contactsAtom } from "./readModel";

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

const result = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Parameters<typeof AtomRegistry.getResult<A, E>>[1],
) => Effect.runPromise(AtomRegistry.getResult(registry, atom));

describe("contacts read model", () => {
  it("follows contact writes with their read cursor, and counts the groups of unarchived contacts", async () => {
    openLinkyStore.mockResolvedValue(makeTestLinkyStore().store);
    const registry = makeTestAppRegistry({ session: signedInSession() });
    const contacts = await result(registry, contactsRepositoryAtom);
    const conversations = await result(registry, conversationsRepositoryAtom);
    const unsubscribe = registry.subscribe(contactGroupsAtom, () => {});
    const alice = createId<"Contact">();
    const bob = createId<"Contact">();
    const team = text(serializeContactGroups(["Team"]));

    await Effect.runPromise(
      contacts.insert({ id: alice, name: text("Alice"), groupNamesJson: team }),
    );
    await Effect.runPromise(
      contacts.insert({
        id: bob,
        name: text("Bob"),
        groupNamesJson: team,
        archivedAtSec: PositiveInt.orThrow(10),
      }),
    );
    await Effect.runPromise(
      Effect.flatMap(conversations.ensureDirect(alice), (chat) =>
        conversations.markSeen(chat.id, PositiveInt.orThrow(42)),
      ),
    );

    await vi.waitFor(() =>
      expect(
        registry
          .get(contactsAtom)
          .map(({ id, chatLastSeenAtSec }) => [id, chatLastSeenAtSec]),
      ).toEqual(
        expect.arrayContaining([
          [alice, 42],
          [bob, null],
        ]),
      ),
    );
    expect(registry.get(contactGroupsAtom)).toEqual({
      groupCounts: new Map([["Team", 1]]),
      groupNames: ["Team"],
      ungroupedCount: 0,
    });
    unsubscribe();
  });
});
