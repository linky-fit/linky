import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  createId,
  directConversationIdFor,
  makeContactsRepository,
  makeConversationsRepository,
  makeUnknownSendersRepository,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  nostrMessageIdFor,
  nostrReactionIdFor,
  PositiveInt,
  type ContactId,
  type LinkyStore,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import React, { act } from "react";
import {
  ChatMessageReceived,
  ClientId,
  Pubkey,
  RumorId,
  TextBody,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { getPublicKey } from "nostr-tools";
import { RegistryContext } from "@linky-fit/linkstr-react";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import { makeTestAppRegistry } from "../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { createSecretKey } from "../../testUtils/nostrKeys";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../utils/constants";
import type { NewLocalNostrMessage } from "../types/appTypes";
import type { Route } from "../../types/route";
import { contactsAtom } from "../state/contacts/readModel";
import { chatWritesAtom } from "../state/messages/chatWrites";
import { applyChatMessageReceived } from "./messages/chatInbox";

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));

import { useMessagesDomain } from "./useMessagesDomain";

type MessagesDomain = ReturnType<typeof useMessagesDomain>;

const UNKNOWN_SENDER = "a1".repeat(32);
const unknownSenderId = `${UNKNOWN_CONTACT_ID_PREFIX}${UNKNOWN_SENDER}`;

const fromUnknownSender = (
  content: string,
  wrapId: string,
): NewLocalNostrMessage => ({
  contactId: unknownSenderId,
  content,
  createdAtSec: 100,
  direction: "in",
  pubkey: UNKNOWN_SENDER,
  rumorId: null,
  wrapId,
});

const domainParams = (
  store: LinkyStore,
): Parameters<typeof useMessagesDomain>[0] => ({
  appOwnerId: null,
  chatForceScrollToBottomRef: { current: false },
  chatMessagesRef: { current: null },
  conversations: makeConversationsRepository(store),
  hydrated: true,
  route: { kind: "contacts" },
  unknownSenders: makeUnknownSendersRepository(store),
});

/** A registry whose session store is `store`, with the chat writes already open. */
const storeRegistry = async (store: LinkyStore) => {
  openLinkyStore.mockResolvedValue(store);
  const registry = makeTestAppRegistry();
  const chatWrites = await Effect.runPromise(
    AtomRegistry.getResult(registry, chatWritesAtom),
  );
  return { chatWrites, registry };
};

const renderDomain = async (
  store: LinkyStore,
  contacts: ReadonlyArray<{ readonly id: ContactId }> = [],
  route: Route = { kind: "contacts" },
) => {
  const domainRef: { current: MessagesDomain | null } = { current: null };
  const params = { ...domainParams(store), route };
  for (const { id } of contacts)
    await Effect.runPromise(
      makeContactsRepository(store).insert({
        id,
        name: NonEmptyString1000.orThrow("Contact"),
      }),
    );
  const { chatWrites, registry } = await storeRegistry(store);
  const Probe = () => {
    const domain = useMessagesDomain(params);
    React.useEffect(() => {
      domainRef.current = domain;
    }, [domain]);
    return null;
  };
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  const domain = (): MessagesDomain => {
    if (!domainRef.current) throw new Error("hook did not render");
    return domainRef.current;
  };
  return { chatWrites, domain, registry, view, ...params };
};

const rumorId = RumorId.make("a".repeat(64));
const PEER = Pubkey.make(makeIdentity().pubkey);
const ME = Pubkey.make(makeIdentity().pubkey);

const fromNostr = (contactId: string): NewLocalNostrMessage => ({
  contactId,
  content: "hello",
  createdAtSec: 100,
  direction: "in",
  pubkey: "peer",
  rumorId,
  status: "sent",
  wrapId: rumorId,
});

describe("useMessagesDomain", () => {
  it("stores an unknown sender's message in their scope and follows it to their contact", async () => {
    const { store } = makeTestLinkyStore();
    const contactId = createId<"Contact">();
    const { conversations, domain, unknownSenders, view } = await renderDomain(
      store,
      [{ id: contactId }],
    );

    await act(async () => {
      domain().appendLocalNostrMessage(fromNostr(unknownSenderId));
    });
    expect(domain().nostrMessagesLocal.map((message) => message.id)).toEqual([
      nostrMessageIdFor(rumorId),
    ]);
    expect(domain().nostrMessagesLocal[0]?.contactId).toBe(unknownSenderId);
    const stored = await Effect.runPromise(unknownSenders.all);
    expect(stored.map((row) => [row.id, row.peerPubkey])).toEqual([
      [nostrMessageIdFor(rumorId), UNKNOWN_SENDER],
    ]);
    expect(await Effect.runPromise(conversations.messages.all)).toEqual([]);

    await act(async () => {
      await Effect.runPromise(
        unknownSenders.moveToContact(Pubkey.make(UNKNOWN_SENDER), contactId),
      );
    });
    const rows = await Effect.runPromise(conversations.messages.all);
    expect(rows.map((row) => [row.id, row.conversationId])).toEqual([
      [nostrMessageIdFor(rumorId), directConversationIdFor(contactId)],
    ]);
    expect(await Effect.runPromise(unknownSenders.all)).toEqual([]);
    expect(domain().nostrMessagesLocal.map((m) => m.contactId)).toEqual([
      contactId,
    ]);
    await view.unmount();
  });

  it("updates and deletes an unknown sender's messages in their scope", async () => {
    const { store } = makeTestLinkyStore();
    const { domain, unknownSenders, view } = await renderDomain(store);

    await act(async () => {
      domain().appendLocalNostrMessage(fromNostr(unknownSenderId));
    });
    await act(async () => {
      domain().updateLocalNostrMessage(nostrMessageIdFor(rumorId), {
        content: "hello, edited",
        isEdited: true,
      });
    });
    expect(
      (await Effect.runPromise(unknownSenders.all)).map((row) => row.content),
    ).toEqual(["hello, edited"]);

    await act(async () => {
      domain().removeLocalNostrMessagesByContactId(unknownSenderId);
    });
    expect(await Effect.runPromise(unknownSenders.all)).toEqual([]);
    expect(domain().nostrMessagesLocal).toEqual([]);
    await view.unmount();
  });

  it.each(["unknownSenders", "messages"] as const)(
    "marks a send in the %s scope sent when its receipt arrives before its row is read back",
    async (scope) => {
      const { store } = makeTestLinkyStore();
      const contactId = createId<"Contact">();
      const { chatWrites, conversations, domain, unknownSenders, view } =
        await renderDomain(store, [{ id: contactId }]);

      await act(async () => {
        const { id } = domain().appendLocalNostrMessage({
          contactId: scope === "messages" ? contactId : unknownSenderId,
          content: "Hi",
          createdAtSec: 100,
          direction: "out",
          pubkey: ME,
          rumorId: null,
          status: "pending",
          wrapId: "pending:send",
        });
        chatWrites.syncLatestMessages([]);
        domain().updateLocalNostrMessage(id, {
          status: "sent",
          wrapId: "e".repeat(64),
        });
      });

      const rows =
        scope === "messages"
          ? await Effect.runPromise(conversations.messages.all)
          : await Effect.runPromise(unknownSenders.all);
      expect(rows.map((row) => [row.status, row.wrapId])).toEqual([
        ["sent", "e".repeat(64)],
      ]);
      await view.unmount();
    },
  );

  it("refuses a reaction its author retracted before it arrived, and only theirs", async () => {
    const { store } = makeTestLinkyStore();
    const contactId = createId<"Contact">();
    const { conversations, domain, view } = await renderDomain(store, [
      { id: contactId },
    ]);
    const retracted = RumorId.make("b".repeat(64));
    const forged = RumorId.make("c".repeat(64));
    const reaction = (wrapId: RumorId, reactorPubkey: string) => ({
      createdAtSec: 101,
      emoji: "👍",
      messageId: rumorId,
      reactorPubkey,
      status: "sent" as const,
      wrapId,
    });

    await act(async () => {
      domain().appendLocalNostrMessage(fromNostr(contactId));
      domain().storeRetractedReaction(retracted, PEER);
      domain().storeRetractedReaction(forged, PEER);
    });
    await act(async () => {
      domain().appendLocalNostrReaction(reaction(retracted, PEER));
      domain().appendLocalNostrReaction(reaction(forged, ME));
    });

    const rows = await Effect.runPromise(conversations.reactions.all);
    expect(rows.map((row) => row.id)).toEqual([nostrReactionIdFor(forged, ME)]);
    expect(domain().nostrReactionsLocal.map((row) => row.wrapId)).toEqual([
      forged,
    ]);
    await view.unmount();
  });

  it("removes a reaction retracted before its row is read back", async () => {
    const { store } = makeTestLinkyStore();
    const contactId = createId<"Contact">();
    const { conversations, domain, view } = await renderDomain(store, [
      { id: contactId },
    ]);
    const reactionRumorId = RumorId.make("b".repeat(64));
    await act(async () => {
      domain().appendLocalNostrMessage(fromNostr(contactId));
    });

    await act(async () => {
      domain().appendLocalNostrReaction({
        createdAtSec: 101,
        emoji: "👍",
        messageId: rumorId,
        reactorPubkey: PEER,
        status: "sent",
        wrapId: reactionRumorId,
      });
      domain().storeRetractedReaction(reactionRumorId, PEER);
    });

    expect(await Effect.runPromise(conversations.reactions.all)).toEqual([]);
    expect(domain().nostrReactionsLocal).toEqual([]);
    await view.unmount();
  });

  it("shows one message when an older random-id row holds the same rumor", async () => {
    const { store } = makeTestLinkyStore();
    const conversations = makeConversationsRepository(store);
    const contactId = createId<"Contact">();
    const conversationId = directConversationIdFor(contactId);
    const row = {
      conversationId,
      direction: NonEmptyString100.orThrow("in"),
      content: NonEmptyString.orThrow("hello"),
      wrapId: NonEmptyString1000.orThrow(rumorId),
      rumorId: NonEmptyString1000.orThrow(rumorId),
      createdAtSec: PositiveInt.orThrow(100),
      status: NonEmptyString100.orThrow("sent"),
    };
    await Effect.runPromise(
      Effect.andThen(
        conversations.ensureDirect(contactId),
        Effect.andThen(
          conversations.messages.insert({ ...row, id: createId<"Message">() }),
          conversations.messages.insert({
            ...row,
            id: nostrMessageIdFor(rumorId),
          }),
        ),
      ),
    );
    const { domain, view } = await renderDomain(store, [{ id: contactId }]);

    expect(domain().nostrMessagesLocal).toHaveLength(1);
    await act(async () => {
      domain().appendLocalNostrMessage(fromNostr(contactId));
    });
    expect(await Effect.runPromise(conversations.messages.all)).toHaveLength(2);
    await view.unmount();
  });

  it("keeps every message of a burst from a sender not in contacts", async () => {
    const { store } = makeTestLinkyStore();
    const { domain, view } = await renderDomain(store);

    await act(async () => {
      domain().appendLocalNostrMessage(fromUnknownSender("first", "w-1"));
      domain().appendLocalNostrMessage(fromUnknownSender("second", "w-2"));
    });

    expect(
      domain().nostrMessagesLocal.map((message) => message.content),
    ).toEqual(["first", "second"]);
    await view.unmount();
  });

  it("keeps the open conversation and unchanged rows when another conversation gets a message", async () => {
    const { store } = makeTestLinkyStore();
    const open = createId<"Contact">();
    const other = createId<"Contact">();
    const { domain, registry, view } = await renderDomain(
      store,
      [{ id: open }, { id: other }],
      { kind: "chat", id: open },
    );
    const message = (
      contactId: ContactId,
      content: string,
      createdAtSec: number,
    ): NewLocalNostrMessage => ({
      contactId,
      content,
      createdAtSec,
      direction: "in",
      pubkey: PEER,
      rumorId: null,
      wrapId: `wrap-${content}`,
    });

    await act(async () => {
      domain().appendLocalNostrMessage(message(open, "first", 100));
      domain().appendLocalNostrMessage(message(other, "elsewhere", 101));
    });
    const chat = domain().chatMessages;
    const [first] = chat;
    const contacts = registry.get(contactsAtom);
    expect(chat.map((row) => row.content)).toEqual(["first"]);

    await act(async () => {
      domain().appendLocalNostrMessage(message(other, "elsewhere again", 102));
    });
    expect(domain().nostrMessagesLocal).toHaveLength(3);
    expect(domain().chatMessages).toBe(chat);
    expect(registry.get(contactsAtom)).toBe(contacts);

    await act(async () => {
      domain().appendLocalNostrMessage(message(open, "second", 103));
    });
    expect(domain().chatMessages.map((row) => row.content)).toEqual([
      "first",
      "second",
    ]);
    expect(domain().chatMessages[0]).toBe(first);
    await view.unmount();
  });

  it("keeps messages that share a client id with another sender or direction", async () => {
    const { store } = makeTestLinkyStore();
    const { domain, view } = await renderDomain(store);
    const alice = getPublicKey(createSecretKey(2));
    const bob = getPublicKey(createSecretKey(3));
    const clientId = ClientId.make("same-client");
    const receive = (from: string, rumorId: string, text: string) => {
      const current = domain();
      applyChatMessageReceived(
        new ChatMessageReceived({
          messageId: RumorId.make(rumorId),
          from: Pubkey.make(from),
          body: new TextBody({ text }),
          replyTo: null,
          root: null,
          editOf: null,
          clientId,
          sentAt: UnixSeconds.make(100),
        }),
        {
          appendLocalNostrMessage: current.appendLocalNostrMessage,
          identitySinceSec: null,
          isBlockedPubkey: () => false,
          logPayStep: () => undefined,
          messages: current.nostrMessagesLocal,
          resolveContactId: () => null,
          updateLocalNostrMessage: current.updateLocalNostrMessage,
          visibleSinceSec: null,
        },
      );
    };

    await act(async () => {
      receive(alice, "a".repeat(64), "from alice");
    });
    await act(async () => {
      receive(bob, "b".repeat(64), "from bob");
    });
    await act(async () => {
      domain().appendLocalNostrMessage({
        clientId,
        contactId: `${UNKNOWN_CONTACT_ID_PREFIX}${alice}`,
        content: "to alice",
        createdAtSec: 101,
        direction: "out",
        pubkey: alice,
        rumorId: null,
        wrapId: "w-out",
      });
    });

    expect(
      domain().nostrMessagesLocal.map((message) => message.content),
    ).toEqual(["from alice", "from bob", "to alice"]);
    await view.unmount();
  });
});
