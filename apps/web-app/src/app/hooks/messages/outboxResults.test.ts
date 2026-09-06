import {
  ChatMessageReceipt,
  ClientId,
  MessageEditReceipt,
  OutboxJobFailed,
  OutboxJobId,
  OutboxJobSucceeded,
  OutboxRef,
  PaymentTelemetryReceipt,
  ReactionReceipt,
  RelayUrl,
  RumorId,
  UnixSeconds,
  WrapDelivery,
  WrapId,
} from "@linky/linkstr";
import type { OutboxReceipt, OutboxResult } from "@linky/linkstr";
import { describe, expect, it, vi } from "vitest";
import { applyOutboxResult } from "./outboxResults";

const rumorId = RumorId.make("ab".repeat(32));
const selfWrapId = WrapId.make("cd".repeat(32));
const delivery = (wrapId: WrapId): WrapDelivery =>
  new WrapDelivery({
    wrapId,
    acceptedBy: [RelayUrl.make("wss://relay.test")],
    rejectedBy: [],
  });
const copies = {
  rumorId,
  clientId: ClientId.make("client-1"),
  sentAt: UnixSeconds.make(1_700_000_000),
  selfCopy: delivery(selfWrapId),
  recipientCopy: delivery(WrapId.make("ef".repeat(32))),
};

const succeeded = (ref: string, receipt: OutboxReceipt): OutboxResult =>
  new OutboxJobSucceeded({
    jobId: OutboxJobId.make("job"),
    ref: OutboxRef.make(ref),
    receipt,
  });

const apply = (result: OutboxResult) => {
  const targets = {
    updateLocalNostrMessage: vi.fn(),
    updateLocalNostrReaction: vi.fn(),
  };
  applyOutboxResult(result, targets);
  return targets;
};

describe("applyOutboxResult", () => {
  it("marks the reaction row sent from a ReactionReceipt", () => {
    const targets = apply(
      succeeded("reaction:row-1", new ReactionReceipt(copies)),
    );
    expect(targets.updateLocalNostrReaction).toHaveBeenCalledWith("row-1", {
      status: "sent",
      wrapId: rumorId,
    });
    expect(targets.updateLocalNostrMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["ChatMessageReceipt", new ChatMessageReceipt(copies), rumorId],
    [
      "MessageEditReceipt",
      new MessageEditReceipt({
        ...copies,
        editOf: RumorId.make("12".repeat(32)),
      }),
      RumorId.make("12".repeat(32)),
    ],
  ])(
    "marks the message row sent from a %s",
    (_name, receipt, expectedRumorId) => {
      const targets = apply(succeeded("message:row-2", receipt));
      expect(targets.updateLocalNostrMessage).toHaveBeenCalledWith("row-2", {
        rumorId: expectedRumorId,
        status: "sent",
        wrapId: selfWrapId,
      });
      expect(targets.updateLocalNostrReaction).not.toHaveBeenCalled();
    },
  );

  it("ignores a receipt whose kind does not match the ref", () => {
    const targets = apply(
      succeeded("message:row-3", new ReactionReceipt(copies)),
    );
    expect(targets.updateLocalNostrMessage).not.toHaveBeenCalled();
    expect(targets.updateLocalNostrReaction).not.toHaveBeenCalled();
  });

  it("ignores telemetry receipts, failed jobs, and foreign refs", () => {
    const { rumorId: id, clientId, sentAt, recipientCopy } = copies;
    const telemetry = new PaymentTelemetryReceipt({
      rumorId: id,
      clientId,
      sentAt,
      recipientCopy,
    });
    const failed = new OutboxJobFailed({
      jobId: OutboxJobId.make("job"),
      ref: OutboxRef.make("reaction:row-4"),
      reason: "unexpected-error",
      detail: "boom",
    });
    for (const result of [
      succeeded("message:row-4", telemetry),
      failed,
      succeeded("telemetry:row-4", new ReactionReceipt(copies)),
    ]) {
      const targets = apply(result);
      expect(targets.updateLocalNostrMessage).not.toHaveBeenCalled();
      expect(targets.updateLocalNostrReaction).not.toHaveBeenCalled();
    }
  });
});
