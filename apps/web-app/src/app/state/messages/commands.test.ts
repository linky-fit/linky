// @vitest-environment jsdom
import {
  createId,
  directConversationIdFor,
  NonEmptyString1000,
  type ContactId,
  type ConversationId,
} from "@linky-fit/linksync";
import { Pubkey } from "@linky-fit/linkstr";
import { Effect, Exit } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../../utils/constants";
import {
  toMessageWriteRow,
  toUnknownSenderWriteRow,
} from "../../hooks/messages/messageRows";
import { isIdentityChangeMessageContent } from "../../lib/identityChangeMessage";
import type { NewLocalNostrMessage } from "../../types/appTypes";
import { evoluAtom } from "../session/evolu";
import { sessionAtom } from "../session/session";
import {
  contactsRepositoryAtom,
  conversationsRepositoryAtom,
  SessionSignedOut,
  unknownSendersRepositoryAtom,
} from "../session/store";
import { messagesCommandsAtom } from "./commands";

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

const UNKNOWN_SENDER = Pubkey.make("a1".repeat(32));

const result = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Parameters<typeof AtomRegistry.getResult<A, E>>[1],
) => Effect.runPromise(AtomRegistry.getResult(registry, atom));

const boot = async () => {
  openLinkyStore.mockResolvedValue(makeTestLinkyStore().store);
  const registry = makeTestAppRegistry({ session: signedInSession() });
  return {
    commands: await result(registry, messagesCommandsAtom),
    contacts: await result(registry, contactsRepositoryAtom),
    conversations: await result(registry, conversationsRepositoryAtom),
    unknownSenders: await result(registry, unknownSendersRepositoryAtom),
  };
};

type Booted = Awaited<ReturnType<typeof boot>>;

const message = (
  contactId: string,
  content: string,
  wrapId: string,
): NewLocalNostrMessage => ({
  contactId,
  content,
  createdAtSec: 100,
  direction: "in",
  pubkey: UNKNOWN_SENDER,
  rumorId: null,
  wrapId,
});

const addContact = async ({ contacts }: Booted): Promise<ContactId> => {
  const id = createId<"Contact">();
  await Effect.runPromise(
    contacts.insert({ id, name: NonEmptyString1000.orThrow("Alice") }),
  );
  return id;
};

const addMessage = async (
  { conversations }: Booted,
  contactId: ContactId,
  content: string,
) => {
  const wrapId = `wrap-${content}`;
  const row = toMessageWriteRow(
    createId<"Message">(),
    directConversationIdFor(contactId),
    message(contactId, content, wrapId),
    wrapId,
  );
  if (!row) throw new Error("unstorable message");
  await Effect.runPromise(
    Effect.andThen(
      conversations.ensureDirect(contactId),
      conversations.messages.insert(row),
    ),
  );
};

const conversationsOfMessages = async ({ conversations }: Booted) =>
  (await Effect.runPromise(conversations.messages.all)).map(
    (row) => row.conversationId,
  );

beforeEach(() => reportAppLog.mockClear());

describe("messagesCommandsAtom", () => {
  it("fails while signed out without computing the once-per-page database", async () => {
    const registry = makeTestAppRegistry({ session: { _tag: "SignedOut" } });

    const exit = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, messagesCommandsAtom),
    );
    registry.set(sessionAtom, signedInSession());

    expect(exit).toEqual(Exit.fail(new SessionSignedOut()));
    expect(registry.get(evoluAtom)).not.toBeNull();
  });
});

describe("reassignContactMessages", () => {
  it("moves a duplicate contact's messages to the kept contact", async () => {
    const booted = await boot();
    const duplicate = await addContact(booted);
    const kept = await addContact(booted);
    await addMessage(booted, duplicate, "one");
    await addMessage(booted, duplicate, "two");
    await addMessage(booted, kept, "three");

    const moved = await booted.commands.reassignContactMessages(
      duplicate,
      kept,
    );

    expect(moved).toBe(2);
    expect(new Set(await conversationsOfMessages(booted))).toEqual(
      new Set<ConversationId>([directConversationIdFor(kept)]),
    );
  });

  it("moves an unknown sender's messages into their contact's conversation", async () => {
    const booted = await boot();
    const contactId = await addContact(booted);
    const unknownContactId = `${UNKNOWN_CONTACT_ID_PREFIX}${UNKNOWN_SENDER}`;
    const row = toUnknownSenderWriteRow(
      createId<"Message">(),
      UNKNOWN_SENDER,
      message(unknownContactId, "hello", "wrap-unknown"),
      "wrap-unknown",
    );
    if (!row) throw new Error("unstorable message");
    await Effect.runPromise(booted.unknownSenders.insert(row));

    const moved = await booted.commands.reassignContactMessages(
      unknownContactId,
      contactId,
    );

    expect(moved).toBe(1);
    expect(await Effect.runPromise(booted.unknownSenders.all)).toEqual([]);
    expect(await conversationsOfMessages(booted)).toEqual([
      directConversationIdFor(contactId),
    ]);
    expect(reportAppLog).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "unknownSenders.movedToContact" }),
    );
  });

  it("moves nothing onto the same contact", async () => {
    const booted = await boot();
    const contactId = await addContact(booted);
    await addMessage(booted, contactId, "one");

    expect(
      await booted.commands.reassignContactMessages(contactId, contactId),
    ).toBe(0);
  });
});

describe("appendIdentityChangeNotices", () => {
  const notices = async ({ conversations }: Booted) =>
    (await Effect.runPromise(conversations.messages.all))
      .filter((row) => isIdentityChangeMessageContent(row.content ?? ""))
      .map((row) => [row.conversationId, row.localOnly]);

  it("adds one local notice to every conversation with a message, once", async () => {
    const booted = await boot();
    const chatting = await addContact(booted);
    await addContact(booted);
    await addMessage(booted, chatting, "hello");
    const change = {
      changedAtSec: 1_730_000_000,
      identitySource: "custom",
    } as const;

    await booted.commands.appendIdentityChangeNotices(change);
    await booted.commands.appendIdentityChangeNotices(change);

    expect(await notices(booted)).toEqual([
      [directConversationIdFor(chatting), "1"],
    ]);
  });
});
