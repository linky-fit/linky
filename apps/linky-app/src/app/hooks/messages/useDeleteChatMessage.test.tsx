import {
  ClientId,
  DeleteMessageDraft,
  EnqueueReceipt,
  OutboxJobId,
  RumorId,
  UnixSeconds,
} from "@linky-fit/linkstr";
import type { EnqueueOutboxInput } from "@linky-fit/linkstr-react";
import { Exit } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { NO_WRITE } from "../../lib/storeWrite";
import type {
  ContactIdentityRowLike,
  LocalNostrMessage,
} from "../../types/appTypes";

type EnqueueOutbox = (
  input: EnqueueOutboxInput,
) => Promise<Exit.Exit<EnqueueReceipt, { readonly _tag: string }>>;

const { enqueueOutboxMock } = vi.hoisted(() => ({
  enqueueOutboxMock: vi.fn<EnqueueOutbox>(),
}));

vi.mock("@linky-fit/linkstr-react", () => ({
  useLinkstrCommands: () => ({ enqueueOutbox: enqueueOutboxMock }),
}));

import { useDeleteChatMessage } from "./useDeleteChatMessage";

const MY_PRIVATE_KEY = createSecretKey(3);
const CONTACT_PRIVATE_KEY = createSecretKey(4);
const CONTACT_PUBKEY = getPublicKey(CONTACT_PRIVATE_KEY);
const CURRENT_NSEC = nip19.nsecEncode(MY_PRIVATE_KEY);
const CONTACT_NPUB = nip19.npubEncode(CONTACT_PUBKEY);
const MESSAGE_RUMOR_ID = RumorId.make("11".repeat(32));
const DELETION_RUMOR_ID = RumorId.make("22".repeat(32));
const SENT_AT = UnixSeconds.make(1_730_000_000);

const message = (
  overrides: Partial<LocalNostrMessage> = {},
): LocalNostrMessage => ({
  id: "local-message",
  contactId: "contact-1",
  content: "hello",
  createdAtSec: SENT_AT,
  direction: "in",
  pubkey: CONTACT_PUBKEY,
  rumorId: MESSAGE_RUMOR_ID,
  wrapId: MESSAGE_RUMOR_ID,
  ...overrides,
});

const setup = async () => {
  let deleteChatMessage:
    | ((message: LocalNostrMessage) => Promise<void>)
    | null = null;
  const markLocalNostrMessageDeleted = vi.fn(() => NO_WRITE);
  const setStatus = vi.fn();

  const Harness = () => {
    const remove = useDeleteChatMessage({
      currentNsec: CURRENT_NSEC,
      markLocalNostrMessageDeleted,
      selectedContact: {
        id: "contact-1",
        npub: CONTACT_NPUB,
      } satisfies ContactIdentityRowLike,
      setStatus,
      t: (key) => key,
    });
    React.useEffect(() => {
      deleteChatMessage = remove;
    }, [remove]);
    return null;
  };

  const { root } = await renderIntoDocument(<Harness />);
  return {
    getDelete: () => deleteChatMessage,
    markLocalNostrMessageDeleted,
    root,
    setStatus,
  };
};

describe("useDeleteChatMessage", () => {
  afterEach(() => {
    enqueueOutboxMock.mockReset();
  });

  it("marks the row deleted at once and queues a deletion naming the rumor and its kind", async () => {
    enqueueOutboxMock.mockImplementation(async (input) =>
      Exit.succeed(
        new EnqueueReceipt({
          jobId: OutboxJobId.make("job-1"),
          ref: input.ref,
          rumorId: DELETION_RUMOR_ID,
          clientId: input.op.draft.clientId ?? ClientId.make("fallback"),
          sentAt: SENT_AT,
        }),
      ),
    );
    const harness = await setup();
    const target = message();

    await act(async () => {
      await harness.getDelete()?.(target);
    });

    expect(harness.markLocalNostrMessageDeleted).toHaveBeenCalledWith(target);
    const input = enqueueOutboxMock.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      op: { _tag: "chat.delete" },
      ref: "deletion:local-message",
    });
    const draft = input?.op._tag === "chat.delete" ? input.op.draft : undefined;
    expect(draft).toBeInstanceOf(DeleteMessageDraft);
    expect(draft).toMatchObject({
      to: CONTACT_PUBKEY,
      deleteOf: MESSAGE_RUMOR_ID,
      deleteOfKind: "text",
    });
    expect(harness.setStatus).not.toHaveBeenCalled();

    await act(async () => harness.root.unmount());
  });

  it("only marks a message that never got a rumor id", async () => {
    const harness = await setup();
    const target = message({ rumorId: null });

    await act(async () => {
      await harness.getDelete()?.(target);
    });

    expect(harness.markLocalNostrMessageDeleted).toHaveBeenCalledWith(target);
    expect(enqueueOutboxMock).not.toHaveBeenCalled();

    await act(async () => harness.root.unmount());
  });
});
