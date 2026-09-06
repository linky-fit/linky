import { Either } from "effect";
import { isRumorId } from "../domain/primitives";
import type { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import type { DropReason } from "../inbox/events";
import {
  firstTagValue,
  firstTrimmedTagValue,
  Rumor,
  rumorWithHash,
  tagValues,
} from "../internal/nostrEvent";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import type { PaymentNoticeDraft } from "./domain";
import { PaymentNoticeReceived } from "./events";
import type { PaymentNoticeInboxEvent } from "./events";

export const PAYMENT_NOTICE_KIND = 24133;
export const PAYMENT_NOTICE_VALUE = "payment_notice";

export const encodePaymentNoticeRumor = (
  draft: PaymentNoticeDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor =>
  rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: PAYMENT_NOTICE_KIND,
    tags: [
      ["p", draft.to],
      ["p", author],
      ["client", clientId],
      ["linky", PAYMENT_NOTICE_VALUE],
      ...(draft.context === undefined ? [] : [["context", draft.context]]),
      ...(draft.offerId === undefined ? [] : [["offer", draft.offerId]]),
    ],
    content: PAYMENT_NOTICE_VALUE,
  });

export const decodePaymentNoticeRumor = (
  rumor: Rumor,
  identity: LinkstrIdentityService,
): Either.Either<PaymentNoticeInboxEvent, DropReason> => {
  if (
    rumor.kind !== PAYMENT_NOTICE_KIND ||
    !rumor.tags.some(
      (tag) => tag[0] === "linky" && tag[1] === PAYMENT_NOTICE_VALUE,
    ) ||
    rumor.pubkey === identity.pubkey ||
    !tagValues(rumor.tags, "p").includes(identity.pubkey) ||
    !isRumorId(rumor.id)
  ) {
    return Either.left("invalid-notice");
  }

  return Either.right(
    new PaymentNoticeReceived({
      noticeId: rumor.id,
      from: rumor.pubkey,
      context:
        firstTagValue(rumor.tags, "context") === "bank_payment_offer"
          ? "bank_payment_offer"
          : null,
      offerId: firstTrimmedTagValue(rumor.tags, "offer"),
      sentAt: rumor.created_at,
    }),
  );
};
