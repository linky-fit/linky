// @vitest-environment jsdom
import { createId, type ContactId } from "@linky-fit/linksync";
import { Pubkey } from "@linky-fit/linkstr";
import { Effect, Exit } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vitest";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { readPendingPayments } from "../../lib/pendingPayments";
import type { NewLocalNostrMessage } from "../../types/appTypes";
import {
  appOwnerIdAtom,
  conversationsRepositoryAtom,
  SessionSignedOut,
} from "../session/store";
import { chatWritesAtom, pendingPaymentsKeyFor } from "./chatWrites";

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));

const PEER = Pubkey.make("a1".repeat(32));

const result = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Parameters<typeof AtomRegistry.getResult<A, E>>[1],
) => Effect.runPromise(AtomRegistry.getResult(registry, atom));

const boot = async () => {
  openLinkyStore.mockResolvedValue(makeTestLinkyStore().store);
  const registry = makeTestAppRegistry({ session: signedInSession() });
  return {
    appOwnerId: await result(registry, appOwnerIdAtom),
    conversations: await result(registry, conversationsRepositoryAtom),
    registry,
    writes: await result(registry, chatWritesAtom),
  };
};

const outgoing = (contactId: ContactId): NewLocalNostrMessage => ({
  contactId,
  content: "hello",
  createdAtSec: 100,
  direction: "out",
  pubkey: "",
  rumorId: null,
  status: "pending",
  wrapId: "pending:hello",
});

describe("chatWritesAtom", () => {
  it("fails while signed out", async () => {
    const registry = makeTestAppRegistry({ session: { _tag: "SignedOut" } });
    expect(
      await Effect.runPromiseExit(
        AtomRegistry.getResult(registry, chatWritesAtom),
      ),
    ).toEqual(Exit.fail(new SessionSignedOut()));
  });

  it("stores a message appended twice before the store is read back once, and tells listeners", async () => {
    const { conversations, writes } = await boot();
    const contactId = createId<"Contact">();
    const appendedTo = vi.fn();
    const stopListening = writes.onMessageAppended(appendedTo);

    const first = writes.appendLocalNostrMessage(outgoing(contactId));
    const again = writes.appendLocalNostrMessage(outgoing(contactId));
    await first.written;
    stopListening();

    expect(again.id).toBe(first.id);
    expect(await Effect.runPromise(conversations.messages.all)).toHaveLength(1);
    expect(appendedTo.mock.calls).toEqual([[contactId]]);
  });

  it("applies an update issued right after the insert", async () => {
    const { conversations, writes } = await boot();
    const appended = writes.appendLocalNostrMessage(
      outgoing(createId<"Contact">()),
    );

    const updated = await writes.updateLocalNostrMessage(appended.id, {
      status: "sent",
    });

    expect(updated).toEqual({ ok: true });
    const [row] = await Effect.runPromise(conversations.messages.all);
    expect(row?.status).toBe("sent");
  });

  it("queues an offline payment under the owner's key", async () => {
    const { appOwnerId, writes } = await boot();
    const contactId = createId<"Contact">();

    writes.enqueuePendingPayment({
      amountSat: 21.7,
      contactId,
      recipientPubkey: PEER,
      messageId: "message-1",
    });

    const key = pendingPaymentsKeyFor(appOwnerId);
    expect(key).not.toBeNull();
    expect(readPendingPayments(key ?? "")).toEqual([
      expect.objectContaining({
        amountSat: 21,
        contactId,
        messageId: "message-1",
        recipientPubkey: PEER,
      }),
    ]);
  });
});
