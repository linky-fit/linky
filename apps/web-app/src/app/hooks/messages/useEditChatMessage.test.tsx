import {
  ClientId,
  EditMessageDraft,
  EnqueueReceipt,
  OutboxJobId,
  OutboxRef,
  RumorId,
  UnixSeconds,
} from "@linky/linkstr";
import type { EnqueueOutboxInput } from "@linky/linkstr-react";
import { Exit } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type {
  ContactIdentityRowLike,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";

type EnqueueOutbox = (
  input: EnqueueOutboxInput,
) => Promise<Exit.Exit<EnqueueReceipt, { readonly _tag: string }>>;

const { enqueueOutboxMock } = vi.hoisted(() => ({
  enqueueOutboxMock: vi.fn<EnqueueOutbox>(),
}));

vi.mock("@linky/linkstr-react", () => ({
  enqueueOutboxAtom: "enqueueOutboxAtom",
  useAtomSet: () => enqueueOutboxMock,
}));

import { useEditChatMessage } from "./useEditChatMessage";

const MY_PRIVATE_KEY = createSecretKey(3);
const CONTACT_PRIVATE_KEY = createSecretKey(4);
const CONTACT_PUBKEY = getPublicKey(CONTACT_PRIVATE_KEY);
const CURRENT_NSEC = nip19.nsecEncode(MY_PRIVATE_KEY);
const CONTACT_NPUB = nip19.npubEncode(CONTACT_PUBKEY);
const EDITED_FROM = RumorId.make("11".repeat(32));
const EDIT_MESSAGE_ID = RumorId.make("22".repeat(32));
const SENT_AT = UnixSeconds.make(1_730_000_000);

const receipt = (clientId: ClientId, ref: OutboxRef): EnqueueReceipt =>
  new EnqueueReceipt({
    jobId: OutboxJobId.make("job-1"),
    ref,
    rumorId: EDIT_MESSAGE_ID,
    clientId,
    sentAt: SENT_AT,
  });

const setup = async () => {
  let editChatMessage: (() => Promise<void>) | null = null;
  const setChatDraft = vi.fn();
  const setChatSendIsBusy = vi.fn();
  const setEditContext = vi.fn();
  const setStatus = vi.fn();
  const updateLocalNostrMessage = vi.fn<UpdateLocalNostrMessage>();

  const Harness = () => {
    const edit = useEditChatMessage({
      chatDraft: "updated text",
      chatSendIsBusy: false,
      currentNsec: CURRENT_NSEC,
      editContext: {
        messageId: "local-message",
        originalContent: "original text",
        rumorId: EDITED_FROM,
      },
      route: { kind: "chat" },
      selectedContact: {
        id: "contact-1",
        npub: CONTACT_NPUB,
      } satisfies ContactIdentityRowLike,
      setChatDraft,
      setChatSendIsBusy,
      setEditContext,
      setStatus,
      t: (key) => key,
      updateLocalNostrMessage,
    });

    React.useEffect(() => {
      editChatMessage = edit;
    }, [edit]);
    return null;
  };

  const { root } = await renderIntoDocument(<Harness />);

  return {
    getEdit: () => editChatMessage,
    root,
    setChatDraft,
    setChatSendIsBusy,
    setEditContext,
    setStatus,
    updateLocalNostrMessage,
  };
};

describe("useEditChatMessage", () => {
  afterEach(() => {
    enqueueOutboxMock.mockReset();
    vi.restoreAllMocks();
  });

  it("enqueues an edit and stores the enqueue receipt on the pending row", async () => {
    enqueueOutboxMock.mockImplementation(async (input) =>
      Exit.succeed(
        receipt(
          input.op.draft.clientId ?? ClientId.make("fallback"),
          input.ref,
        ),
      ),
    );
    const harness = await setup();

    await act(async () => {
      await harness.getEdit()?.();
    });

    const input = enqueueOutboxMock.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      op: { _tag: "chat.edit" },
      ref: "message:local-message",
    });
    const draft = input?.op._tag === "chat.edit" ? input.op.draft : undefined;
    expect(draft).toBeInstanceOf(EditMessageDraft);
    expect(draft).toMatchObject({
      to: CONTACT_PUBKEY,
      editOf: EDITED_FROM,
      content: "updated text",
    });
    expect(draft?.clientId).toBeTruthy();
    expect(harness.updateLocalNostrMessage).toHaveBeenNthCalledWith(
      1,
      "local-message",
      expect.objectContaining({
        clientId: draft?.clientId,
        content: "updated text",
        editedAtSec: expect.any(Number),
        editedFromId: EDITED_FROM,
        isEdited: true,
        originalContent: "original text",
        rumorId: EDITED_FROM,
        status: "pending",
        wrapId: `pending:edit:${String(draft?.clientId)}`,
      }),
    );
    expect(harness.updateLocalNostrMessage).toHaveBeenNthCalledWith(
      2,
      "local-message",
      {
        createdAtSec: SENT_AT,
        rumorId: EDITED_FROM,
      },
    );
    expect(harness.setChatDraft).toHaveBeenCalledWith("");
    expect(harness.setEditContext).toHaveBeenCalledWith(null);
    expect(harness.setChatSendIsBusy).toHaveBeenNthCalledWith(1, true);
    expect(harness.setChatSendIsBusy).toHaveBeenLastCalledWith(false);

    await act(async () => harness.root.unmount());
  });

  it("leaves the edit pending when enqueue fails", async () => {
    enqueueOutboxMock.mockResolvedValue(
      Exit.fail({ _tag: "LinkstrNotConfigured" }),
    );
    const harness = await setup();

    await act(async () => {
      await harness.getEdit()?.();
    });

    expect(harness.updateLocalNostrMessage).toHaveBeenCalledOnce();
    expect(harness.updateLocalNostrMessage).toHaveBeenCalledWith(
      "local-message",
      expect.objectContaining({
        rumorId: EDITED_FROM,
        status: "pending",
      }),
    );
    expect(harness.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("errorPrefix"),
    );
    expect(harness.setChatSendIsBusy).toHaveBeenLastCalledWith(false);

    await act(async () => harness.root.unmount());
  });
});
