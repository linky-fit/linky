import {
  ClientId,
  EnqueueReceipt,
  ImageMessageDraft,
  OutboxJobId,
  OutboxRef,
  RumorId,
  TextMessageDraft,
  UnixSeconds,
} from "@linky/linkstr";
import type { EnqueueOutboxInput } from "@linky/linkstr-react";
import { Exit } from "effect";
import { getPublicKey, nip19 } from "nostr-tools";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSecretKey } from "../../../testUtils/nostrKeys";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { PrivateImageMessagePayload } from "../../lib/privateImageMessage";
import { serializePrivateImageMessage } from "../../lib/privateImageMessage";
import type {
  ContactIdentityRowLike,
  NewLocalNostrMessage,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import type { ReplyContext } from "./useSendChatMessage";

type EnqueueOutbox = (
  input: EnqueueOutboxInput,
) => Promise<Exit.Exit<EnqueueReceipt, { readonly _tag: string }>>;
type CreatePrivateImageSendPayload = (
  file: File,
  auth: { privateKey: Uint8Array; pubkey: string },
) => Promise<{ content: string }>;

const { createPrivateImageSendPayloadMock, enqueueOutboxMock } = vi.hoisted(
  () => ({
    createPrivateImageSendPayloadMock: vi.fn<CreatePrivateImageSendPayload>(),
    enqueueOutboxMock: vi.fn<EnqueueOutbox>(),
  }),
);

vi.mock("@linky/linkstr-react", () => ({
  enqueueOutboxAtom: "enqueueOutboxAtom",
  useAtomSet: () => enqueueOutboxMock,
}));

vi.mock("../../lib/privateImageMessage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/privateImageMessage")>();
  return {
    ...actual,
    createPrivateImageSendPayload: createPrivateImageSendPayloadMock,
  };
});

import { useSendChatMessage } from "./useSendChatMessage";

const MY_PRIVATE_KEY = createSecretKey(1);
const CONTACT_PRIVATE_KEY = createSecretKey(2);
const MY_PUBKEY = getPublicKey(MY_PRIVATE_KEY);
const CONTACT_PUBKEY = getPublicKey(CONTACT_PRIVATE_KEY);
const CURRENT_NSEC = nip19.nsecEncode(MY_PRIVATE_KEY);
const CONTACT_NPUB = nip19.npubEncode(CONTACT_PUBKEY);
const REPLY_TO = RumorId.make("11".repeat(32));
const ROOT = RumorId.make("22".repeat(32));
const MESSAGE_ID = RumorId.make("33".repeat(32));
const SENT_AT = UnixSeconds.make(1_730_000_000);

const receipt = (clientId: ClientId, ref: OutboxRef): EnqueueReceipt =>
  new EnqueueReceipt({
    jobId: OutboxJobId.make("job-1"),
    ref,
    rumorId: MESSAGE_ID,
    clientId,
    sentAt: SENT_AT,
  });

interface SendOptions {
  clearDraft?: boolean;
  imageFile?: File | null;
  replyContext?: ReplyContext | null;
  text?: string;
}

type SendChatMessage = (options?: SendOptions) => Promise<void>;

interface SetupOptions {
  chatDraft?: string;
  replyContext?: ReplyContext | null;
}

const setup = async (options: SetupOptions = {}) => {
  let sendChatMessage: SendChatMessage | null = null;
  const operations: string[] = [];
  const appendLocalNostrMessage = vi.fn<
    (message: NewLocalNostrMessage) => string
  >(() => {
    operations.push("append");
    return "pending-message";
  });
  const setChatDraft = vi.fn();
  const setChatSendIsBusy = vi.fn();
  const setReplyContext = vi.fn();
  const setStatus = vi.fn();
  const triggerChatScrollToBottom = vi.fn();
  const updateLocalNostrMessage = vi.fn<UpdateLocalNostrMessage>(() => {
    operations.push("update");
  });
  const replyContext = options.replyContext ?? null;

  const Harness = () => {
    const send = useSendChatMessage({
      appendLocalNostrMessage,
      chatDraft: options.chatDraft ?? "hello",
      chatSendIsBusy: false,
      currentNsec: CURRENT_NSEC,
      route: { kind: "chat" },
      replyContext,
      replyContextRef: { current: replyContext },
      selectedContact: {
        id: "contact-1",
        npub: CONTACT_NPUB,
      } satisfies ContactIdentityRowLike,
      setReplyContext,
      setChatDraft,
      setChatSendIsBusy,
      setStatus,
      t: (key) => key,
      triggerChatScrollToBottom,
      updateLocalNostrMessage,
    });

    React.useEffect(() => {
      sendChatMessage = send;
    }, [send]);
    return null;
  };

  const { root } = await renderIntoDocument(<Harness />);

  return {
    appendLocalNostrMessage,
    getSend: () => sendChatMessage,
    operations,
    root,
    setChatDraft,
    setChatSendIsBusy,
    setReplyContext,
    setStatus,
    triggerChatScrollToBottom,
    updateLocalNostrMessage,
  };
};

describe("useSendChatMessage", () => {
  afterEach(() => {
    createPrivateImageSendPayloadMock.mockReset();
    enqueueOutboxMock.mockReset();
    vi.restoreAllMocks();
  });

  it("enqueues text with reply context and stores receipt fields", async () => {
    const harness = await setup({
      replyContext: {
        replyToContent: "parent",
        replyToId: REPLY_TO,
        rootMessageId: ROOT,
      },
    });
    enqueueOutboxMock.mockImplementation(async (input) => {
      harness.operations.push("enqueue");
      return Exit.succeed(
        receipt(
          input.op.draft.clientId ?? ClientId.make("fallback"),
          input.ref,
        ),
      );
    });

    await act(async () => {
      await harness.getSend()?.();
    });

    const input = enqueueOutboxMock.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      op: { _tag: "chat.text" },
      ref: "message:pending-message",
    });
    const draft = input?.op._tag === "chat.text" ? input.op.draft : undefined;
    expect(draft).toBeInstanceOf(TextMessageDraft);
    expect(draft).toMatchObject({
      to: CONTACT_PUBKEY,
      content: "hello",
      replyTo: REPLY_TO,
      root: ROOT,
    });
    expect(draft?.clientId).toBeTruthy();
    expect(harness.appendLocalNostrMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: draft?.clientId,
        content: "hello",
        pubkey: MY_PUBKEY,
        replyToId: REPLY_TO,
        rootMessageId: ROOT,
        rumorId: null,
        status: "pending",
        wrapId: `pending:${String(draft?.clientId)}`,
      }),
    );
    expect(harness.triggerChatScrollToBottom).toHaveBeenCalledWith(
      "pending-message",
    );
    expect(harness.updateLocalNostrMessage).toHaveBeenCalledWith(
      "pending-message",
      {
        createdAtSec: SENT_AT,
        rumorId: MESSAGE_ID,
      },
    );
    expect(harness.operations).toEqual(["append", "enqueue", "update"]);
    expect(harness.setChatDraft).toHaveBeenCalledWith("");
    expect(harness.setChatSendIsBusy).toHaveBeenNthCalledWith(1, true);
    expect(harness.setChatSendIsBusy).toHaveBeenLastCalledWith(false);

    await act(async () => harness.root.unmount());
  });

  it("sends an uploaded image draft and stores its compact content", async () => {
    const image: PrivateImageMessagePayload = {
      encryptedSha256: "44".repeat(32),
      encryptedSize: 128,
      encryptionAlgorithm: "aes-gcm",
      fileType: "image/jpeg",
      height: 480,
      key: "55".repeat(32),
      nonce: "66".repeat(12),
      originalSha256: "77".repeat(32),
      storageEncoding: "base64",
      type: "linky.private_image.v1",
      url: "https://blossom.example/image",
      width: 640,
    };
    const compactContent = serializePrivateImageMessage(image);
    createPrivateImageSendPayloadMock.mockResolvedValue({
      content: compactContent,
    });
    enqueueOutboxMock.mockImplementation(async (input) =>
      Exit.succeed(
        receipt(
          input.op.draft.clientId ?? ClientId.make("fallback"),
          input.ref,
        ),
      ),
    );
    const harness = await setup({ chatDraft: "caption ignored" });
    const file = new File(["image"], "photo.jpg", { type: "image/jpeg" });

    await act(async () => {
      await harness.getSend()?.({ imageFile: file });
    });

    const input = enqueueOutboxMock.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      op: { _tag: "chat.image" },
      ref: "message:pending-message",
    });
    const draft = input?.op._tag === "chat.image" ? input.op.draft : undefined;
    expect(draft).toBeInstanceOf(ImageMessageDraft);
    expect(draft?.to).toBe(CONTACT_PUBKEY);
    expect(draft?.image).toMatchObject({
      encryptedSha256: image.encryptedSha256,
      encryptedSize: image.encryptedSize,
      fileType: image.fileType,
      url: image.url,
    });
    expect(draft?.image).not.toHaveProperty("type");
    expect(harness.appendLocalNostrMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: compactContent,
        rumorId: null,
      }),
    );
    expect(harness.updateLocalNostrMessage).toHaveBeenCalledWith(
      "pending-message",
      expect.objectContaining({
        createdAtSec: SENT_AT,
        rumorId: MESSAGE_ID,
      }),
    );

    await act(async () => harness.root.unmount());
  });

  it("keeps the row pending when enqueue fails", async () => {
    enqueueOutboxMock.mockResolvedValue(
      Exit.fail({ _tag: "LinkstrNotConfigured" }),
    );
    const harness = await setup();

    await act(async () => {
      await harness.getSend()?.();
    });

    expect(harness.appendLocalNostrMessage).toHaveBeenCalledOnce();
    expect(harness.updateLocalNostrMessage).not.toHaveBeenCalled();
    expect(harness.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("errorPrefix"),
    );
    expect(harness.setChatSendIsBusy).toHaveBeenLastCalledWith(false);

    await act(async () => harness.root.unmount());
  });

  it("enqueues offline and shows the queued status", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const harness = await setup();
    enqueueOutboxMock.mockImplementation(async (input) =>
      Exit.succeed(
        receipt(
          input.op.draft.clientId ?? ClientId.make("fallback"),
          input.ref,
        ),
      ),
    );

    await act(async () => {
      await harness.getSend()?.();
    });

    expect(harness.appendLocalNostrMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: expect.any(String),
        content: "hello",
        createdAtSec: expect.any(Number),
        rumorId: null,
        status: "pending",
      }),
    );
    expect(enqueueOutboxMock).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "message:pending-message" }),
    );
    expect(harness.updateLocalNostrMessage).toHaveBeenCalledWith(
      "pending-message",
      { createdAtSec: SENT_AT, rumorId: MESSAGE_ID },
    );
    expect(harness.setStatus).toHaveBeenCalledWith("chatQueued");

    await act(async () => harness.root.unmount());
  });
});
