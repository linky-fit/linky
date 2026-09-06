import {
  CashuTokenText,
  ClientId,
  decodeNpub,
  OutboxRef,
  PaymentNoticeDraft,
  Pubkey,
  RumorId,
  TokenMessageDraft,
} from "@linky/linkstr";
import type {
  EnqueueReceipt,
  PaymentNoticeContext,
  PaymentNoticeReceipt,
} from "@linky/linkstr";
import type { EnqueueOutboxInput } from "@linky/linkstr-react";
import { Cause, Either, Exit, Option, Schema } from "effect";
import type { ContactId } from "../../../evolu";
import { previewTokenText } from "../../../utils/formatting";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { makeLocalId } from "../../../utils/validation";
import type {
  LocalNostrMessage,
  NewLocalNostrMessage,
  PaymentLogData,
  UpdateLocalNostrMessage,
} from "../../types/appTypes";
import type { ReplyContext } from "../messages/useSendChatMessage";
import type {
  CashuMessagePaymentPublishingOutcome,
  CashuMessagePaymentSendBatch,
} from "./cashuMessagePaymentTypes";

type SendExit<A> = Exit.Exit<A, { readonly _tag: string }>;

export type EnqueueOutbox = (
  input: EnqueueOutboxInput,
) => Promise<SendExit<EnqueueReceipt>>;

export type SendPaymentNotice = (
  draft: PaymentNoticeDraft,
) => Promise<SendExit<PaymentNoticeReceipt>>;

interface PublishCashuMessagePaymentDependencies {
  makeId?: () => string;
  nowSec?: () => number;
}

interface PublishCashuMessagePaymentArgs {
  appendLocalNostrMessage: (message: NewLocalNostrMessage) => string;
  batches: readonly CashuMessagePaymentSendBatch[];
  contactId: ContactId;
  contactNpub: string;
  currentNpub: string;
  dependencies?: PublishCashuMessagePaymentDependencies;
  enqueueOutbox: EnqueueOutbox;
  logPayStep: (step: string, data?: PaymentLogData) => void;
  nostrMessagesLocal: readonly LocalNostrMessage[];
  paymentNoticeContext?: PaymentNoticeContext;
  paymentNoticeOfferId?: string;
  pendingMessageId: string | null;
  replyContext?: ReplyContext | null;
  sendPaymentNotice: SendPaymentNotice;
  updateLocalNostrMessage: UpdateLocalNostrMessage;
}

const isRumorId = Schema.is(RumorId);
const decodeCashuTokenText = Schema.decodeUnknownEither(CashuTokenText);

const decodeRequiredNpub = (npub: string): Pubkey => {
  const pubkey = decodeNpub(npub);
  if (!pubkey) throw new Error("invalid npub");
  return pubkey;
};

const failureMessage = (
  cause: Cause.Cause<{ readonly _tag: string }>,
): string =>
  Option.match(Cause.failureOption(cause), {
    onNone: () => Cause.pretty(cause),
    onSome: (failure) => failure._tag,
  });

export const publishCashuMessagePayment = async ({
  appendLocalNostrMessage,
  batches,
  contactId,
  contactNpub,
  currentNpub,
  dependencies,
  enqueueOutbox,
  logPayStep,
  nostrMessagesLocal,
  paymentNoticeContext,
  paymentNoticeOfferId,
  pendingMessageId,
  replyContext,
  sendPaymentNotice,
  updateLocalNostrMessage,
}: PublishCashuMessagePaymentArgs): Promise<CashuMessagePaymentPublishingOutcome> => {
  const myPublicKey = decodeRequiredNpub(currentNpub);
  const contactPublicKey = decodeRequiredNpub(contactNpub);

  const createId = dependencies?.makeId ?? makeLocalId;
  const nowSec = dependencies?.nowSec ?? (() => Math.ceil(Date.now() / 1_000));

  const publishedTokenTexts = new Set<string>();
  const unpublishedTokenTexts = new Set<string>();
  const publishErrors: CashuMessagePaymentPublishingOutcome["publishErrors"] =
    [];
  let reusedPendingMessage = false;
  let publishedAnyTokenMessage = false;

  const canReusePendingMessage = Boolean(
    pendingMessageId &&
    nostrMessagesLocal.some((message) => message.id === pendingMessageId),
  );

  const replyToRaw = (replyContext?.replyToId ?? "").trim();
  const replyTo = isRumorId(replyToRaw) ? replyToRaw : undefined;
  const rootRaw = (replyContext?.rootMessageId ?? "").trim();
  const root =
    replyTo !== undefined && isRumorId(rootRaw) ? rootRaw : undefined;

  for (const batch of [...batches].reverse()) {
    const messageText = batch.token.trim();
    logPayStep("plan-send-token", {
      amount: batch.amount,
      mint: batch.mint,
      token: previewTokenText(batch.token),
    });

    const clientId = ClientId.make(createId());
    logPayStep("publish-pending", {
      clientId,
      token: previewTokenText(messageText),
    });

    let localMessageId = "";
    let messageId: RumorId | null = null;
    let sendError: string | null = null;
    try {
      const token = decodeCashuTokenText(messageText);
      if (Either.isLeft(token)) {
        sendError = "invalid cashu token";
      } else {
        if (canReusePendingMessage && !reusedPendingMessage) {
          localMessageId = pendingMessageId ?? "";
          reusedPendingMessage = true;
          updateLocalNostrMessage(localMessageId, {
            clientId,
            content: messageText,
            localOnly: false,
            pubkey: myPublicKey,
            status: "pending",
            wrapId: `pending:${clientId}`,
          });
        } else {
          localMessageId = appendLocalNostrMessage({
            ...(replyContext?.replyToId
              ? {
                  replyToContent: replyContext.replyToContent,
                  replyToId: replyContext.replyToId,
                  rootMessageId:
                    (replyContext.rootMessageId ?? "").trim() ||
                    replyContext.replyToId,
                }
              : {}),
            clientId,
            contactId: contactId,
            content: messageText,
            createdAtSec: nowSec(),
            direction: "out",
            pubkey: myPublicKey,
            rumorId: null,
            status: "pending",
            wrapId: `pending:${clientId}`,
          });
        }
        if (!localMessageId) throw new Error("failed to persist message");

        const draft = new TokenMessageDraft({
          to: contactPublicKey,
          token: token.right,
          clientId,
          ...(replyTo === undefined ? {} : { replyTo }),
          ...(root === undefined ? {} : { root }),
        });
        const exit = await enqueueOutbox({
          op: { _tag: "chat.token", draft },
          ref: OutboxRef.make(`message:${localMessageId}`),
        });
        if (Exit.isSuccess(exit)) {
          messageId = exit.value.rumorId;
          updateLocalNostrMessage(localMessageId, {
            createdAtSec: exit.value.sentAt,
            rumorId: exit.value.rumorId,
          });
        } else {
          sendError = failureMessage(exit.cause);
        }
      }
    } catch (error) {
      sendError = getUnknownErrorMessage(error, "publish failed");
    }

    if (messageId === null) {
      const error = sendError ?? "publish failed";
      logPayStep("publish-failed", { clientId, error });
      unpublishedTokenTexts.add(messageText);
      publishErrors.push({ clientId, error, token: messageText });
      continue;
    }

    logPayStep("publish-ok", { clientId, messageId });
    publishedAnyTokenMessage = true;
    publishedTokenTexts.add(messageText);
  }

  let paymentNoticeError: string | null = null;
  if (publishedAnyTokenMessage) {
    const clientId = ClientId.make(createId());
    const offerId = (paymentNoticeOfferId ?? "").trim();
    let anySuccess = false;
    let error: string | null = null;
    let wrapId: string | null = null;
    try {
      const exit = await sendPaymentNotice(
        new PaymentNoticeDraft({
          to: contactPublicKey,
          clientId,
          ...(paymentNoticeContext === undefined
            ? {}
            : { context: paymentNoticeContext }),
          ...(offerId === "" ? {} : { offerId }),
        }),
      );
      if (Exit.isSuccess(exit)) {
        anySuccess = true;
        wrapId = exit.value.recipientCopy.wrapId;
      } else {
        error = failureMessage(exit.cause);
      }
    } catch (caught) {
      error = getUnknownErrorMessage(caught, "publish failed");
    }
    paymentNoticeError = anySuccess ? null : (error ?? "publish failed");
    logPayStep("payment-notice-publish", {
      anySuccess,
      clientId,
      error,
      wrapId,
    });
  }

  return {
    hasPendingMessages: unpublishedTokenTexts.size > 0,
    paymentNoticeError,
    publishErrors,
    publishedTokenTexts: Array.from(publishedTokenTexts),
    unpublishedTokenTexts: Array.from(unpublishedTokenTexts),
  };
};
