import {
  createId,
  makeConversationsRepository,
  type ContactId,
} from "@linky/linksync";
import { Effect } from "effect";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { LocalNostrMessage } from "../../types/appTypes";
import { useChatReadCursorSync } from "./useChatReadCursorSync";

type Params = Parameters<typeof useChatReadCursorSync>[0];

const incoming = (createdAtSec: number): LocalNostrMessage => ({
  id: `m-${createdAtSec}`,
  contactId: "c",
  content: "hi",
  createdAtSec,
  direction: "in",
  pubkey: "peer",
  rumorId: `r-${createdAtSec}`,
  wrapId: `w-${createdAtSec}`,
});

const mount = async (params: Params) => {
  const Probe = ({ params }: { params: Params }) => {
    useChatReadCursorSync(params);
    return null;
  };
  const view = await renderIntoDocument(<Probe params={params} />);
  return {
    ...view,
    update: (next: Params) => view.rerender(<Probe params={next} />),
  };
};

describe("useChatReadCursorSync", () => {
  it("writes the cursor to the contact's conversation in the messages scope only", async () => {
    const { db, store } = makeTestLinkyStore();
    const conversations = makeConversationsRepository(store);
    const contactId: ContactId = createId<"Contact">();
    const params: Params = {
      chatMessages: [incoming(100), incoming(200)],
      conversations,
      documentVisible: true,
      route: { kind: "chat", id: contactId },
      selectedContact: { id: contactId, chatLastSeenAtSec: null },
    };
    const view = await mount(params);
    await act(async () => {
      await Promise.resolve();
    });

    const chat = await Effect.runPromise(conversations.forContact(contactId));
    expect(chat?.lastSeenAtSec).toBe(200);
    const contactsOwner = store.shardOwner("contacts", 0).id;
    const messagesOwner = store.shardOwner("messages", 0).id;
    expect(chat?.ownerId).toBe(messagesOwner);
    expect(chat?.ownerId).not.toBe(contactsOwner);
    expect(await Effect.runPromise(db.readTable("contact"))).toHaveLength(0);
    await view.unmount();
  });

  it("does not write when the stored cursor already covers the newest message or the tab is hidden", async () => {
    const { store } = makeTestLinkyStore();
    const conversations = makeConversationsRepository(store);
    const contactId: ContactId = createId<"Contact">();
    const view = await mount({
      chatMessages: [incoming(100)],
      conversations,
      documentVisible: true,
      route: { kind: "chat", id: contactId },
      selectedContact: { id: contactId, chatLastSeenAtSec: 100 },
    });
    await view.update({
      chatMessages: [incoming(100), incoming(300)],
      conversations,
      documentVisible: false,
      route: { kind: "chat", id: contactId },
      selectedContact: { id: contactId, chatLastSeenAtSec: 100 },
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(await Effect.runPromise(conversations.all)).toHaveLength(0);
    await view.unmount();
  });
});
