// @vitest-environment jsdom
import {
  createId,
  directConversationIdFor,
  NonEmptyString1000,
} from "@linky-fit/linksync";
import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../../utils/constants";
import { toUnknownSenderWriteRow } from "../../hooks/messages/messageRows";
import {
  contactsRepositoryAtom,
  conversationsRepositoryAtom,
  unknownSendersRepositoryAtom,
} from "../session/store";
import { contactsCommandsAtom } from "./commands";

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));
const reportAppLog = vi.hoisted(() => vi.fn());
vi.mock("../../../devtools/inspector/appLog", () => ({ reportAppLog }));

const result = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Parameters<typeof AtomRegistry.getResult<A, E>>[1],
) => Effect.runPromise(AtomRegistry.getResult(registry, atom));

const boot = async () => {
  openLinkyStore.mockResolvedValue(makeTestLinkyStore().store);
  const registry = makeTestAppRegistry({ session: signedInSession() });
  return {
    commands: await result(registry, contactsCommandsAtom),
    contacts: await result(registry, contactsRepositoryAtom),
    conversations: await result(registry, conversationsRepositoryAtom),
    unknownSenders: await result(registry, unknownSendersRepositoryAtom),
  };
};

describe("contacts commands", () => {
  it("archives a contact with its chat read, then restores it with what its npub sent meanwhile", async () => {
    const { commands, contacts, conversations, unknownSenders } = await boot();
    const peer = makeIdentity();
    const id = createId<"Contact">();
    await Effect.runPromise(
      contacts.insert({
        id,
        name: NonEmptyString1000.orThrow("Bob"),
        npub: NonEmptyString1000.orThrow(encodeNpub(peer.pubkey)),
      }),
    );

    expect(await commands.archiveContact(id)).toEqual({ ok: true });
    const archived = await Effect.runPromise(contacts.byId(id));
    expect(archived?.archivedAtSec).toBeGreaterThan(0);
    expect(reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "conversations.archived" }),
    );

    const unknownContactId = `${UNKNOWN_CONTACT_ID_PREFIX}${peer.pubkey}`;
    const row = toUnknownSenderWriteRow(
      createId<"Message">(),
      peer.pubkey,
      {
        contactId: unknownContactId,
        content: "still there?",
        createdAtSec: 100,
        direction: "in",
        pubkey: peer.pubkey,
        rumorId: null,
        wrapId: "wrap-1",
      },
      "wrap-1",
    );
    if (!row) throw new Error("unstorable message");
    await Effect.runPromise(unknownSenders.insert(row));

    expect(await commands.unarchiveContact(id)).toEqual({ ok: true });
    expect((await Effect.runPromise(contacts.byId(id)))?.archivedAtSec).toBe(
      null,
    );
    await vi.waitFor(async () =>
      expect(
        (await Effect.runPromise(conversations.messages.all)).map(
          (message) => message.conversationId,
        ),
      ).toEqual([directConversationIdFor(id)]),
    );
  });

  it("reports a restore that succeeded when reading the contact back fails", async () => {
    const { commands, contacts } = await boot();
    const id = createId<"Contact">();
    await Effect.runPromise(
      contacts.insert({ id, name: NonEmptyString1000.orThrow("Bob") }),
    );
    expect(await commands.archiveContact(id)).toEqual({ ok: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(contacts, "byId").mockReturnValueOnce(
      Effect.die(new Error("database closed")),
    );

    expect(await commands.unarchiveContact(id)).toEqual({ ok: true });
    vi.restoreAllMocks();
    expect((await Effect.runPromise(contacts.byId(id)))?.archivedAtSec).toBe(
      null,
    );
  });
});
