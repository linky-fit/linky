import { createIdFromString } from "@linky-fit/linksync";
import {
  ClientId,
  OutboxJobFailed,
  OutboxJobId,
  OutboxRef,
} from "@linky-fit/linkstr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { NO_WRITE } from "../../lib/storeWrite";
import type { LocalNostrMessage } from "../../types/appTypes";
import { applyOutboxResult } from "../messages/outboxResults";
import type { publishCashuMessagePayment } from "./publishCashuMessagePayment";
import {
  RELAY_ACCEPT_WAIT_MS,
  useSendTokenMessage,
  type SendTokenMessage,
  type TokenMessage,
} from "./useSendTokenMessage";

const publishMock = vi.hoisted(() =>
  vi.fn<typeof publishCashuMessagePayment>(),
);
vi.mock("./publishCashuMessagePayment", () => ({
  publishCashuMessagePayment: publishMock,
}));
vi.mock("@linky-fit/linkstr-react", () => ({
  enqueueOutboxAtom: "enqueueOutboxAtom",
  sendPaymentNoticeAtom: "sendPaymentNoticeAtom",
  useAtomSet: () => vi.fn(),
}));

const CLIENT_ID = ClientId.make("run-client-id");
const CONTACT_ID = createIdFromString<"Contact">("contact");

const message: TokenMessage = {
  amount: 100,
  clientId: CLIENT_ID,
  contactId: CONTACT_ID,
  contactNpub: "npub1alice",
  mint: "https://mint.example",
  tokenText: "cashuBtoken",
};

const row = (
  status: "sent" | "pending" | null,
  direction: "in" | "out" = "out",
): LocalNostrMessage => ({
  clientId: CLIENT_ID,
  contactId: CONTACT_ID,
  content: "cashuBtoken",
  createdAtSec: 1,
  direction,
  id: "row-1",
  pubkey: "me",
  rumorId: "rumor-1",
  ...(status === null ? {} : { status }),
  wrapId: "wrap-1",
});

const failOutboxJob = () =>
  applyOutboxResult(
    new OutboxJobFailed({
      jobId: OutboxJobId.make("job"),
      ref: OutboxRef.make("message:row-1"),
      reason: "unexpected-error",
      detail: "boom",
    }),
    { updateLocalNostrMessage: vi.fn(), updateLocalNostrReaction: vi.fn() },
  );

const published = (error: string | null) => ({
  hasPendingMessages: error !== null,
  paymentNoticeError: null,
  publishErrors:
    error === null
      ? []
      : [{ clientId: CLIENT_ID, error, token: "cashuBtoken" }],
  publishedTokenTexts: error === null ? ["cashuBtoken"] : [],
  unpublishedTokenTexts: error === null ? [] : ["cashuBtoken"],
});

const Probe = ({
  messages,
  onRender,
}: {
  messages: readonly LocalNostrMessage[];
  onRender: (send: SendTokenMessage) => void;
}) => {
  onRender(
    useSendTokenMessage({
      appendLocalNostrMessage: () => ({ id: "row-1", written: NO_WRITE }),
      currentNpub: "npub1me",
      logPayStep: () => undefined,
      nostrMessagesLocal: messages,
      updateLocalNostrMessage: () => NO_WRITE,
    }),
  );
  return null;
};

const mount = async (messages: readonly LocalNostrMessage[]) => {
  let send: SendTokenMessage | null = null;
  const probe = (current: readonly LocalNostrMessage[]) => (
    <Probe
      messages={current}
      onRender={(value) => {
        send = value;
      }}
    />
  );
  const view = await renderIntoDocument(probe(messages));
  return {
    ...view,
    send: (): ReturnType<SendTokenMessage> => {
      if (send === null) throw new Error("not rendered");
      return send(message);
    },
    setMessages: (next: readonly LocalNostrMessage[]) =>
      view.rerender(probe(next)),
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  publishMock.mockResolvedValue(published(null));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useSendTokenMessage", () => {
  it("is sent without queueing anything once the message's row is sent", async () => {
    const view = await mount([row("sent")]);

    await expect(view.send()).resolves.toEqual({ status: "sent" });
    expect(publishMock).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("queues a message once and stays queued while no relay took it", async () => {
    const view = await mount([]);

    const first = view.send();
    await vi.advanceTimersByTimeAsync(RELAY_ACCEPT_WAIT_MS);
    await expect(first).resolves.toEqual({ status: "queued" });
    await expect(view.send()).resolves.toEqual({ status: "queued" });
    expect(publishMock).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("is sent as soon as a relay accepts the queued message", async () => {
    const view = await mount([]);

    const sending = view.send();
    await vi.advanceTimersByTimeAsync(1_000);
    await view.setMessages([row("sent")]);
    await vi.advanceTimersByTimeAsync(500);

    await expect(sending).resolves.toEqual({ status: "sent" });
    await view.unmount();
  });

  it("queues again, into the same row, a message another device left pending", async () => {
    const view = await mount([row("pending")]);

    const sending = view.send();
    await vi.advanceTimersByTimeAsync(RELAY_ACCEPT_WAIT_MS);

    await expect(sending).resolves.toEqual({ status: "queued" });
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock.mock.calls[0]?.[0].pendingMessageId).toBe("row-1");
    await view.unmount();
  });

  it("queues a message whose status column has not synced yet", async () => {
    const view = await mount([row(null)]);

    const sending = view.send();
    await vi.advanceTimersByTimeAsync(RELAY_ACCEPT_WAIT_MS);

    await expect(sending).resolves.toEqual({ status: "queued" });
    expect(publishMock).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("does not take an incoming message with the same client id as delivery", async () => {
    const view = await mount([row("sent", "in")]);

    const sending = view.send();
    await vi.advanceTimersByTimeAsync(RELAY_ACCEPT_WAIT_MS);

    await expect(sending).resolves.toEqual({ status: "queued" });
    expect(publishMock).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("fails when the outbox gives up on the message, and queues it again next time", async () => {
    const view = await mount([row("pending")]);

    const sending = view.send();
    await vi.advanceTimersByTimeAsync(1_000);
    failOutboxJob();
    await vi.advanceTimersByTimeAsync(500);
    await expect(sending).resolves.toEqual({
      status: "failed",
      error: "outbox job failed",
    });

    const retry = view.send();
    await vi.advanceTimersByTimeAsync(RELAY_ACCEPT_WAIT_MS);
    await expect(retry).resolves.toEqual({ status: "queued" });
    expect(publishMock).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it("fails when the message cannot be queued, and tries again next time", async () => {
    publishMock.mockResolvedValueOnce(published("invalid cashu token"));
    const view = await mount([]);

    await expect(view.send()).resolves.toEqual({
      status: "failed",
      error: "invalid cashu token",
    });
    const retry = view.send();
    await vi.advanceTimersByTimeAsync(RELAY_ACCEPT_WAIT_MS);
    await expect(retry).resolves.toEqual({ status: "queued" });
    expect(publishMock).toHaveBeenCalledTimes(2);
    await view.unmount();
  });
});
