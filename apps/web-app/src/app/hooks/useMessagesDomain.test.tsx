import { makeIdentity } from "@linky-fit/linkstr/testing";
import {
  createId,
  directConversationIdFor,
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
import { describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { createSecretKey } from "../../testUtils/nostrKeys";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../utils/constants";
import type { NewLocalNostrMessage } from "../types/appTypes";
import { applyChatMessageReceived } from "./messages/chatInbox";

vi.mock("./useLinksync", () => ({ useConversationRows: () => [] }));

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
  contacts: ReadonlyArray<{ readonly id: ContactId }> = [],
): Parameters<typeof useMessagesDomain>[0] => ({
  appOwnerId: null,
  chatForceScrollToBottomRef: { current: false },
  chatMessagesRef: { current: null },
  contacts,
  conversations: makeConversationsRepository(store),
  hydrated: true,
  route: { kind: "contacts" },
  unknownSenders: makeUnknownSendersRepository(store),
});

const renderDomain = async (
  store: LinkyStore,
  contacts: ReadonlyArray<{ readonly id: ContactId }> = [],
) => {
  const domainRef: { current: MessagesDomain | null } = { current: null };
  const params = domainParams(store, contacts);
  const Probe = () => {
    const domain = useMessagesDomain(params);
    React.useEffect(() => {
      domainRef.current = domain;
    }, [domain]);
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  const domain = (): MessagesDomain => {
    if (!domainRef.current) throw new Error("hook did not render");
    return domainRef.current;
  };
  return { domain, view, ...params };
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
  it("stores an unknown sender's message in their scope and moves it when they become a contact", async () => {
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
      expect(
        domain().reassignLocalNostrMessagesContactId(
          unknownSenderId,
          contactId,
        ),
      ).toBe(1);
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
      const { conversations, domain, unknownSenders, view } =
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
        domain().nostrMessagesLatestRef.current = [];
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
      Effect.zipRight(
        conversations.ensureDirect(contactId),
        Effect.zipRight(
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

  it("prunes a reaction without its message only once the account is hydrated", async () => {
    vi.useFakeTimers();
    const { store } = makeTestLinkyStore();
    const conversations = makeConversationsRepository(store);
    const text = NonEmptyString1000.orThrow;
    await Effect.runPromise(
      conversations.reactions.insert({
        id: createId<"Reaction">(),
        conversationId: directConversationIdFor(createId<"Contact">()),
        messageId: text("message-in-a-shard-still-syncing"),
        reactorPubkey: text("peer"),
        emoji: NonEmptyString100.orThrow("👍"),
        createdAtSec: PositiveInt.orThrow(100),
        wrapId: text("wrap-1"),
      }),
    );
    const params = { ...domainParams(store), conversations, hydrated: false };
    const Probe = ({ hydrated }: { hydrated: boolean }) => {
      useMessagesDomain({ ...params, hydrated });
      return null;
    };
    const reactions = () => Effect.runPromise(conversations.reactions.all);
    const view = await renderIntoDocument(<Probe hydrated={false} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(await reactions()).toHaveLength(1);

    await view.rerender(<Probe hydrated />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(await reactions()).toHaveLength(0);
    await view.unmount();
    vi.useRealTimers();
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
