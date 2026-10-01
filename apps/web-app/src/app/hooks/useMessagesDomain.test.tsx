import { makeConversationsRepository } from "@linky-fit/linksync";
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
});
