import { RumorId } from "@linky-fit/linkstr";
import {
  createId,
  directConversationIdFor,
  makeConversationsRepository,
  NonEmptyString,
  NonEmptyString100,
  NonEmptyString1000,
  nostrMessageIdFor,
  nostrReactionIdFor,
  PositiveInt,
  type ContactId,
  type ConversationsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { UNKNOWN_CONTACT_ID_PREFIX } from "../../utils/constants";
import type { NewLocalNostrMessage } from "../types/appTypes";

vi.mock("./useLinksync", () => ({ useConversationRows: () => [] }));

import { useMessagesDomain } from "./useMessagesDomain";

type MessagesDomain = ReturnType<typeof useMessagesDomain>;

const fromStranger = (
  content: string,
  wrapId: string,
): NewLocalNostrMessage => ({
  contactId: `${UNKNOWN_CONTACT_ID_PREFIX}stranger`,
  content,
  createdAtSec: 100,
  direction: "in",
  pubkey: "stranger",
  rumorId: null,
  wrapId,
});

const renderDomain = async (
  conversations: ConversationsRepository,
  contacts: ReadonlyArray<{ readonly id: ContactId }> = [],
) => {
  const domainRef: { current: MessagesDomain | null } = { current: null };
  const params: Parameters<typeof useMessagesDomain>[0] = {
    appOwnerId: null,
    appOwnerIdRef: { current: null },
    chatForceScrollToBottomRef: { current: false },
    chatMessagesRef: { current: null },
    contacts,
    conversations,
    hydrated: true,
    route: { kind: "contacts" },
  };
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
  return { domain, view };
};

const rumorId = RumorId.make("a".repeat(64));

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
  it("stores a message from Nostr under the id its rumor derives, and keeps it when its sender becomes a contact", async () => {
    const { store } = makeTestLinkyStore();
    const conversations = makeConversationsRepository(store);
    const contactId = createId<"Contact">();
    const { domain, view } = await renderDomain(conversations, [
      { id: contactId },
    ]);
    const unknownId = `${UNKNOWN_CONTACT_ID_PREFIX}peer`;

    await act(async () => {
      domain().appendLocalNostrMessage(fromNostr(unknownId));
    });
    expect(domain().nostrMessagesLocal.map((message) => message.id)).toEqual([
      nostrMessageIdFor(rumorId),
    ]);

    await act(async () => {
      domain().reassignLocalNostrMessagesContactId(unknownId, contactId);
    });
    const rows = await Effect.runPromise(conversations.messages.all);
    expect(rows.map((row) => row.id)).toEqual([nostrMessageIdFor(rumorId)]);
    expect(domain().nostrMessagesLocal).toHaveLength(1);
    await view.unmount();
  });

  it("stores a reaction from Nostr under the id its rumor derives", async () => {
    const { store } = makeTestLinkyStore();
    const conversations = makeConversationsRepository(store);
    const contactId = createId<"Contact">();
    const { domain, view } = await renderDomain(conversations, [
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
        reactorPubkey: "peer",
        status: "sent",
        wrapId: reactionRumorId,
      });
    });
    const rows = await Effect.runPromise(conversations.reactions.all);
    expect(rows.map((row) => row.id)).toEqual([
      nostrReactionIdFor(reactionRumorId),
    ]);
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
    const { domain, view } = await renderDomain(conversations, [
      { id: contactId },
    ]);

    expect(domain().nostrMessagesLocal).toHaveLength(1);
    await act(async () => {
      domain().appendLocalNostrMessage(fromNostr(contactId));
    });
    expect(await Effect.runPromise(conversations.messages.all)).toHaveLength(2);
    await view.unmount();
  });

  it("keeps every message of a burst from a sender not in contacts", async () => {
    const { store } = makeTestLinkyStore();
    const conversations = makeConversationsRepository(store);
    const params: Parameters<typeof useMessagesDomain>[0] = {
      appOwnerId: null,
      appOwnerIdRef: { current: null },
      chatForceScrollToBottomRef: { current: false },
      chatMessagesRef: { current: null },
      contacts: [],
      conversations,
      hydrated: true,
      route: { kind: "contacts" },
    };
    const domainRef: { current: MessagesDomain | null } = { current: null };
    const Probe = () => {
      const domain = useMessagesDomain(params);
      React.useEffect(() => {
        domainRef.current = domain;
      }, [domain]);
      return null;
    };
    const view = await renderIntoDocument(<Probe />);

    await act(async () => {
      domainRef.current?.appendLocalNostrMessage(fromStranger("first", "w-1"));
      domainRef.current?.appendLocalNostrMessage(fromStranger("second", "w-2"));
    });

    expect(
      domainRef.current?.nostrMessagesLocal.map((message) => message.content),
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
    const params: Parameters<typeof useMessagesDomain>[0] = {
      appOwnerId: null,
      appOwnerIdRef: { current: null },
      chatForceScrollToBottomRef: { current: false },
      chatMessagesRef: { current: null },
      contacts: [],
      conversations,
      hydrated: false,
      route: { kind: "contacts" },
    };
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
});
