import {
  createId,
  directConversationIdFor,
  makeConversationsRepository,
  NonEmptyString100,
  NonEmptyString1000,
  PositiveInt,
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

describe("useMessagesDomain", () => {
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
