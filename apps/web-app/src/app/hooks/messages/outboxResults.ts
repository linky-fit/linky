import type { OutboxRef, OutboxResult } from "@linky/linkstr";
import { appendPushDebugLog } from "../../../utils/pushDebugLog";
import type {
  UpdateLocalNostrMessage,
  UpdateLocalNostrReaction,
} from "../../types/appTypes";

type ParsedOutboxRef =
  | { id: string; kind: "message" }
  | { id: string; kind: "reaction" };

const parseOutboxRef = (ref: OutboxRef): ParsedOutboxRef | null => {
  for (const kind of ["message", "reaction"] as const) {
    const prefix = `${kind}:`;
    if (!ref.startsWith(prefix)) continue;
    const id = ref.slice(prefix.length).trim();
    return id ? { id, kind } : null;
  }
  return null;
};

export interface OutboxResultTargets {
  readonly updateLocalNostrMessage: UpdateLocalNostrMessage;
  readonly updateLocalNostrReaction: UpdateLocalNostrReaction;
}

/** Reconciles one outbox terminal into the local row its `ref` names. */
export const applyOutboxResult = (
  result: OutboxResult,
  { updateLocalNostrMessage, updateLocalNostrReaction }: OutboxResultTargets,
): void => {
  const parsedRef = parseOutboxRef(result.ref);
  if (!parsedRef) return;

  if (result._tag === "OutboxJobFailed") {
    appendPushDebugLog("client", "outbox job failed", {
      detail: result.detail,
      reason: result.reason,
      ref: result.ref,
    });
    return;
  }

  const receipt = result.receipt;
  switch (receipt._tag) {
    case "ChatMessageReceipt":
    case "MessageEditReceipt":
      if (parsedRef.kind !== "message") return;
      updateLocalNostrMessage(parsedRef.id, {
        rumorId:
          receipt._tag === "MessageEditReceipt"
            ? receipt.editOf
            : receipt.rumorId,
        status: "sent",
        wrapId: receipt.selfCopy.wrapId,
      });
      return;
    case "ReactionReceipt":
      if (parsedRef.kind !== "reaction") return;
      updateLocalNostrReaction(parsedRef.id, {
        status: "sent",
        wrapId: receipt.rumorId,
      });
      return;
    case "PaymentTelemetryReceipt":
      return;
  }
};
