import {
  createId,
  makeContactsRepository,
  makeConversationsRepository,
  PositiveInt,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { useConversationArchiveMigration } from "./useConversationArchiveMigration";

describe("useConversationArchiveMigration", () => {
  it("copies the archive onto the contact only once hydrated, and once", async () => {
    const { store } = makeTestLinkyStore();
    const contacts = makeContactsRepository(store);
    const conversations = makeConversationsRepository(store);
    const id = createId<"Contact">();
    await Effect.runPromise(contacts.insert({ id }));
    const chat = await Effect.runPromise(conversations.ensureDirect(id));
    await Effect.runPromise(
      conversations.update(chat.id, { archivedAtSec: PositiveInt.orThrow(50) }),
    );
    const contactRows = await Effect.runPromise(contacts.all);
    const conversationRows = await Effect.runPromise(conversations.all);
    const archive = vi.fn(contacts.archive);

    const Probe = ({ hydrated }: { hydrated: boolean }) => {
      // Fresh arrays of the pre-copy rows stand for a render before the copy is read back.
      useConversationArchiveMigration({
        contactRows: [...contactRows],
        contactsRepository: { archive },
        conversationRows: [...conversationRows],
        hydrated,
      });
      return null;
    };
    const view = await renderIntoDocument(<Probe hydrated={false} />);
    await act(async () => {});
    expect(archive).not.toHaveBeenCalled();

    await view.rerender(<Probe hydrated />);
    await view.rerender(<Probe hydrated />);
    await act(async () => {});

    expect(archive).toHaveBeenCalledTimes(1);
    expect((await Effect.runPromise(contacts.byId(id)))?.archivedAtSec).toBe(
      50,
    );
    await view.unmount();
  });
});
