import {
  createId,
  directConversationIdFor,
  makeContactsRepository,
  makeConversationsRepository,
  NonEmptyString1000,
  PositiveInt,
} from "@linky/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { joinContactChatState } from "./contactChatState";

describe("joinContactChatState", () => {
  it("reads the chat state from the contact's direct conversation", async () => {
    const { store } = makeTestLinkyStore();
    const contacts = makeContactsRepository(store);
    const conversations = makeConversationsRepository(store);
    const withChat = createId<"Contact">();
    const withoutChat = createId<"Contact">();
    await Effect.runPromise(
      Effect.all([
        contacts.insert({
          id: withChat,
          name: NonEmptyString1000.orThrow("A"),
        }),
        contacts.insert({ id: withoutChat }),
      ]),
    );
    const chat = await Effect.runPromise(conversations.ensureDirect(withChat));
    await Effect.runPromise(
      Effect.all([
        conversations.markSeen(chat.id, PositiveInt.orThrow(50)),
        conversations.archive(chat.id, PositiveInt.orThrow(60)),
        conversations.setPeerSeen(chat.id, {
          sinceSec: PositiveInt.orThrow(10),
          atSec: PositiveInt.orThrow(40),
        }),
      ]),
    );

    const joined = joinContactChatState(
      await Effect.runPromise(contacts.all),
      await Effect.runPromise(conversations.all),
    );

    expect(chat.id).toBe(directConversationIdFor(withChat));
    expect(joined.find((row) => row.id === withChat)).toMatchObject({
      name: "A",
      archivedAtSec: 60,
      chatLastSeenAtSec: 50,
      chatPeerSeenSinceSec: 10,
      chatPeerSeenAtSec: 40,
    });
    expect(joined.find((row) => row.id === withoutChat)).toMatchObject({
      archivedAtSec: null,
      chatLastSeenAtSec: null,
      chatPeerSeenSinceSec: null,
      chatPeerSeenAtSec: null,
    });
  });
});
