import { Either } from "effect";
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
import {
  decodeSupporterResultRumor,
  SUPPORTER_RESULT_KIND,
} from "../supporterBadges/codec";
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
      return Either.match(decodeChatRumor(rumor, identity, wrap.pubkey), {
        onLeft: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onRight: (event) => event,
      });
    case REACTION_KIND:
    case RETRACTION_KIND:
      return Either.match(decodeReactionRumor(rumor, identity.pubkey), {
        onLeft: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onRight: (event) => event,
      });
    case PAYMENT_NOTICE_KIND:
      return Either.match(decodePaymentNoticeRumor(rumor, identity), {
        onLeft: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onRight: (event) => event,
      });
    case SEEN_RECEIPT_KIND:
      return Either.match(decodeSeenReceiptRumor(rumor, identity.pubkey), {
        onLeft: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onRight: (event) => event,
      });
    case BANK_OFFER_KIND:
      return Either.match(decodeBankOfferRumor(rumor, identity.pubkey), {
        onLeft: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onRight: (event) => event,
      });
    case SUPPORTER_RESULT_KIND:
      return Either.match(decodeSupporterResultRumor(rumor, identity.pubkey), {
        onLeft: (reason) => new WrapDropped({ wrapId: wrap.id, reason }),
        onRight: (event) => event,
      });
    default:
      return new WrapDropped({ wrapId: wrap.id, reason: "unsupported-kind" });
  }
};

export const decodeWrapEvent = (
  raw: unknown,
  identity: LinkstrIdentityService,
): DecodedWrapEvent =>
  Either.match(authenticateWrap(raw, identity), {
    onLeft: (event) => ({ event, rumorKind: null, wrap: null }),
    onRight: ({ rumor, wrap }) => ({
      event: routeRumor(wrap, rumor, identity),
      rumorKind: rumor.kind,
      wrap,
    }),
  });
