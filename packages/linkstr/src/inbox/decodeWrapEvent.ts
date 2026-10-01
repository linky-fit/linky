import { Result } from "effect";
import { APP_MESSAGE_KIND, decodeAppMessageRumor } from "../appMessages/codec";
import { BANK_OFFER_KIND, decodeBankOfferRumor } from "../bankOffers/codec";
import {
  CHAT_IMAGE_KIND,
  CHAT_TEXT_KIND,
  decodeChatRumor,
} from "../chat/codec";
import type { Rumor, SignedWrapEvent } from "../internal/nostrEvent";
import {
  decodePaymentNoticeRumor,
  PAYMENT_NOTICE_KIND,
} from "../paymentNotices/codec";
import {
  decodeReactionRumor,
  REACTION_KIND,
  RETRACTION_KIND,
} from "../reactions/codec";
import {
  decodeSeenReceiptRumor,
  SEEN_RECEIPT_KIND,
} from "../seenReceipts/codec";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import { authenticateWrap } from "./authenticateWrap";
import { WrapDropped } from "./events";
import type { WrapInboxEvent } from "./WrapInbox";

export type DecodedWrapEvent =
  | {
      readonly event: WrapDropped;
      readonly rumorKind: null;
      readonly wrap: null;
    }
  | {
      readonly event: WrapInboxEvent;
      readonly rumorKind: number;
      readonly wrap: SignedWrapEvent;
    };

const routeRumor = (
  wrap: SignedWrapEvent,
  rumor: Rumor,
  identity: LinkstrIdentityService,
): WrapInboxEvent => {
  switch (rumor.kind) {
    case CHAT_TEXT_KIND:
    case CHAT_IMAGE_KIND:
      return Result.match(decodeChatRumor(rumor, identity, wrap.pubkey), {
        onFailure: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onSuccess: (event) => event,
      });
    case REACTION_KIND:
    case RETRACTION_KIND:
      return Result.match(decodeReactionRumor(rumor, identity.pubkey), {
        onFailure: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onSuccess: (event) => event,
      });
    case PAYMENT_NOTICE_KIND:
      return Result.match(decodePaymentNoticeRumor(rumor, identity), {
        onFailure: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onSuccess: (event) => event,
      });
    case SEEN_RECEIPT_KIND:
      return Result.match(decodeSeenReceiptRumor(rumor, identity.pubkey), {
        onFailure: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onSuccess: (event) => event,
      });
    case APP_MESSAGE_KIND:
      return Result.match(decodeAppMessageRumor(rumor, identity), {
        onFailure: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onSuccess: (event) => event,
      });
    case BANK_OFFER_KIND:
      return Result.match(decodeBankOfferRumor(rumor, identity.pubkey), {
        onFailure: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onSuccess: (event) => event,
      });
    default:
      return new WrapDropped({ wrapId: wrap.id, reason: "unsupported-kind" });
  }
};

export const decodeWrapEvent = (
  raw: unknown,
  identity: LinkstrIdentityService,
): DecodedWrapEvent =>
  Result.match(authenticateWrap(raw, identity), {
    onFailure: (event) => ({ event, rumorKind: null, wrap: null }),
    onSuccess: ({ rumor, wrap }) => ({
      event: routeRumor(wrap, rumor, identity),
      rumorKind: rumor.kind,
      wrap,
    }),
  });
