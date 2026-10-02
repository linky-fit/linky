import {
  createId,
  directConversationIdFor,
  makeContactsRepository,
  makeConversationsRepository,
  PositiveInt,
  type ContactId,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { archivesToCopy } from "./conversationArchiveMigration";

const sec = (value: number) => PositiveInt.orThrow(value);

const setup = () => {
  const { store } = makeTestLinkyStore();
  const contacts = makeContactsRepository(store);
  const conversations = makeConversationsRepository(store);
  const contactWithChat = async (archivedOnChatAtSec: number | null) => {
    const id = createId<"Contact">();
    await Effect.runPromise(contacts.insert({ id }));
    const chat = await Effect.runPromise(conversations.ensureDirect(id));
    if (archivedOnChatAtSec !== null)
      await Effect.runPromise(
        conversations.update(chat.id, {
          archivedAtSec: sec(archivedOnChatAtSec),
        }),
      );
    return id;
  };
  const plan = async () =>
    archivesToCopy(
      await Effect.runPromise(contacts.all),
      await Effect.runPromise(conversations.all),
    ).map(({ contactId, archivedAtSec }) => ({ contactId, archivedAtSec }));
  const run = (effect: Effect.Effect<void, unknown>) =>
    Effect.runPromise(effect);
  return { contacts, contactWithChat, conversations, plan, run };
};

describe("archivesToCopy", () => {
  it("copies a conversation's archive onto a contact that has none", async () => {
    const { contactWithChat, plan } = setup();
    const archived = await contactWithChat(100);
    await contactWithChat(null);

    expect(await plan()).toEqual([{ contactId: archived, archivedAtSec: 100 }]);
  });

  it("leaves a contact that already carries an archive alone", async () => {
    const { contacts, contactWithChat, plan, run } = setup();
    const id = await contactWithChat(100);
    await run(contacts.archive(id, sec(150)));

    expect(await plan()).toEqual([]);
  });

  it("does not undo an unarchive with the conversation's archive", async () => {
    const { contacts, contactWithChat, plan, run } = setup();
    const id = await contactWithChat(100);
    await run(contacts.archive(id, sec(100)));
    await run(contacts.unarchive(id));

    expect(await plan()).toEqual([]);
  });

  it("copies an archive an older version wrote after the last unarchive", async () => {
    const { contacts, contactWithChat, conversations, plan, run } = setup();
    const id: ContactId = await contactWithChat(null);
    await run(contacts.unarchive(id));
    await run(
      conversations.update(directConversationIdFor(id), {
        archivedAtSec: sec(300),
      }),
    );

    expect(await plan()).toEqual([{ contactId: id, archivedAtSec: 300 }]);
  });

  it("ignores a conversation whose contact this device does not have", async () => {
    const { contacts, contactWithChat, plan, run } = setup();
    const id = await contactWithChat(100);
    await run(contacts.remove(id));

    expect(await plan()).toEqual([]);
  });
});
