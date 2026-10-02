import type { ClientId } from "@linky-fit/linkstr";
import {
  enqueueOutboxAtom,
  sendPaymentNoticeAtom,
  useAtomSet,
} from "@linky-fit/linkstr-react";
import React from "react";
import type { ContactId } from "../../../evolu";
import { useLatest } from "../../../hooks/useLatest";
import { onMessageJobFailed } from "../messages/outboxResults";
import { sleep } from "../../../utils/time";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import type {
  AppendLocalNostrMessage,
  LocalNostrMessage,
  PaymentLogData,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import { publishCashuMessagePayment } from "./publishCashuMessagePayment";

export interface TokenMessage {
  amount: number;
  clientId: ClientId;
  contactId: ContactId;
  contactNpub: string;
  mint: string;
  tokenText: string;
}

/**
 * `sent` once a relay accepted the recipient's copy, seen here or synced
 * from another device; `queued` while this device's outbox still retries it.
 */
export type TokenMessageDelivery =
  | { status: "sent" }
  | { status: "queued" }
  | { status: "failed"; error: string };

export type SendTokenMessage = (
  message: TokenMessage,
) => Promise<TokenMessageDelivery>;

/** How long a send waits for a relay to accept a message it just queued. */
export const RELAY_ACCEPT_WAIT_MS = 10_000;
const RELAY_ACCEPT_POLL_MS = 250;

const SENT = { status: "sent" } as const;
const QUEUED = { status: "queued" } as const;

interface UseSendTokenMessageParams {
  appendLocalNostrMessage: AppendLocalNostrMessage;
  currentNpub: string | null;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  nostrMessagesLocal: readonly LocalNostrMessage[];
  updateLocalNostrMessage: UpdateLocalNostrMessage;
}

/**
 * Sends token text the wallet already produced to a contact as a chat
 * message. Its row, keyed by `clientId`, turns `sent` when a relay accepts
 * the recipient's copy (token messages publish the self copy only after
 * that), or syncs in `sent` from the device that delivered it. A message is
 * queued once per session until the outbox gives up on it; another device,
 * or this one after a restart, queues it again into the same row, and the
 * recipient keeps one message per `clientId`.
 */
export const useSendTokenMessage = ({
  appendLocalNostrMessage,
  currentNpub,
  logPayStep,
  nostrMessagesLocal,
  updateLocalNostrMessage,
}: UseSendTokenMessageParams): SendTokenMessage => {
  const enqueueOutbox = useAtomSet(enqueueOutboxAtom, { mode: "promiseExit" });
  const sendPaymentNotice = useAtomSet(sendPaymentNoticeAtom, {
    mode: "promiseExit",
  });
  const messagesRef = useLatest(nostrMessagesLocal);
  const queuedRef = React.useRef(new Set<string>());

  React.useEffect(
    () =>
      onMessageJobFailed((messageRowId) => {
        const clientId = messagesRef.current.find(
          (message) => message.id === messageRowId,
        )?.clientId;
        if (clientId !== undefined) queuedRef.current.delete(clientId);
      }),
    [messagesRef],
  );

  const outgoingRow = React.useCallback(
    (clientId: ClientId) =>
      messagesRef.current.find(
        (message) =>
          message.direction === "out" && message.clientId === clientId,
      ),
    [messagesRef],
  );

  const isSent = React.useCallback(
    (clientId: ClientId) => outgoingRow(clientId)?.status === "sent",
    [outgoingRow],
  );

  const waitForRelay = React.useCallback(
    async (clientId: ClientId): Promise<TokenMessageDelivery> => {
      for (
        let waited = 0;
        waited < RELAY_ACCEPT_WAIT_MS &&
        !isSent(clientId) &&
        queuedRef.current.has(clientId);
        waited += RELAY_ACCEPT_POLL_MS
      ) {
        await sleep(RELAY_ACCEPT_POLL_MS);
      }
      if (isSent(clientId)) return SENT;
      return queuedRef.current.has(clientId)
        ? QUEUED
        : { status: "failed", error: "outbox job failed" };
    },
    [isSent],
  );

  return React.useCallback(
    async ({ amount, clientId, contactId, contactNpub, mint, tokenText }) => {
      if (isSent(clientId)) return SENT;
      if (queuedRef.current.has(clientId)) return QUEUED;
      if (!currentNpub) return { status: "failed", error: "missing npub" };
      queuedRef.current.add(clientId);
      const error = await publishCashuMessagePayment({
        appendLocalNostrMessage,
        batches: [{ amount, clientId, mint, token: tokenText, unit: "sat" }],
        contactId,
        contactNpub,
        currentNpub,
        enqueueOutbox,
        logPayStep,
        nostrMessagesLocal: messagesRef.current,
        pendingMessageId: outgoingRow(clientId)?.id ?? null,
        sendPaymentNotice,
        updateLocalNostrMessage,
      }).then(
        (publishing) => publishing.publishErrors[0]?.error ?? null,
        (caught: unknown) => getUnknownErrorMessage(caught, "unknown"),
      );
      if (error !== null) {
        queuedRef.current.delete(clientId);
        return { status: "failed", error };
      }
      return waitForRelay(clientId);
    },
    [
      appendLocalNostrMessage,
      currentNpub,
      enqueueOutbox,
      isSent,
      logPayStep,
      messagesRef,
      outgoingRow,
      sendPaymentNotice,
      updateLocalNostrMessage,
      waitForRelay,
    ],
  );
};
