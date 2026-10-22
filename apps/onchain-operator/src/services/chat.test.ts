import {
  OwnChatMessageConfirmed,
  RumorId,
  TextBody,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { makeConversationsRepository } from "@linky-fit/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { readChats } from "../storage/chat";
import { createChats } from "./chat";
import {
  chatTextFrom,
  deliver,
  fakeNostr,
  nut18Payload,
  testStore,
} from "./testing/fakes";

const setup = () => {
  const conversations = makeConversationsRepository(testStore());
  const nostr = fakeNostr();
  const chats = createChats({
    conversations,
    nostr: nostr.nostr,
    whenHydrated: () => Promise.resolve(),
  });
  const read = (peers: Parameters<typeof readChats>[1] = []) =>
    Effect.runPromise(readChats(conversations, peers));
  return { chats, nostr, read };
};

describe("chats", () => {
  it("keeps one chat per user with their texts and ecash, oldest first", async () => {
    const { nostr, read } = setup();
    const alice = makeIdentity().pubkey;
    const bob = makeIdentity().pubkey;
    const payload = nut18Payload("transfer", 1_000);
    const first = chatTextFrom(alice, "hello", 1_700_000_010);
    await deliver(nostr.inbox, chatTextFrom(alice, payload, 1_700_000_020));
    await deliver(nostr.inbox, first);
    await deliver(nostr.inbox, first);
    await deliver(nostr.inbox, chatTextFrom(bob, "hi", 1_700_000_030));

    const chats = await read();
    expect(chats.map((chat) => chat.peer).sort()).toEqual([alice, bob].sort());
    expect(
      chats.find((chat) => chat.peer === alice)?.messages.map((m) => m.text),
    ).toEqual(["hello", payload]);
  });

  it("files the operator's own messages under the user they went to", async () => {
    const { nostr, read } = setup();
    const user = makeIdentity().pubkey;
    await deliver(
      nostr.inbox,
      new OwnChatMessageConfirmed({
        messageId: RumorId.make("12".repeat(32)),
        to: user,
        body: new TextBody({ text: "sent elsewhere" }),
        replyTo: null,
        root: null,
        editOf: null,
        clientId: null,
        sentAt: UnixSeconds.make(1_700_000_000),
      }),
    );
    expect(await read([user])).toEqual([
      {
        peer: user,
        unread: false,
        messages: [
          expect.objectContaining({ direction: "out", text: "sent elsewhere" }),
        ],
      },
    ]);
  });

  it("lists a user who only requested a transfer, and clears unread once seen", async () => {
    const { chats, nostr, read } = setup();
    const quiet = makeIdentity().pubkey;
    const writer = makeIdentity().pubkey;
    await deliver(nostr.inbox, chatTextFrom(writer, "ping", 1_700_000_050));
    const before = await read([quiet]);
    expect(before.find((chat) => chat.peer === quiet)).toEqual({
      peer: quiet,
      messages: [],
      unread: false,
    });
    expect(before.find((chat) => chat.peer === writer)?.unread).toBe(true);
    await chats.markSeen(writer, 1_700_000_050);
    expect((await read()).find((chat) => chat.peer === writer)?.unread).toBe(
      false,
    );
  });
});
