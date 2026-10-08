import { Effect } from "effect";
import { RelayRejection, WrapDelivery } from "../domain/delivery";
import { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import type {
  ClientId,
  NostrSecretKey,
  Pubkey,
  UnixSeconds,
} from "../domain/primitives";
import { RumorId } from "../domain/primitives";
import type { LinkstrIdentityService } from "../services/LinkstrIdentity";
import type {
  NostrTransportService,
  RelayPublishResult,
} from "../services/NostrTransport";
import type { RelayPolicyService } from "../services/RelayPolicy";
import { wrapRumorFor } from "./giftWrap";
import type { Rumor, SignedWrapEvent } from "./nostrEvent";

export interface GiftWrapDeliveryContext {
  readonly identity: LinkstrIdentityService;
  readonly transport: NostrTransportService;
  readonly relayPolicy: RelayPolicyService;
}

export type WrapDeliveryOrder = "parallel" | "recipientFirst" | "selfFirst";

export interface DeliveredCopies {
  readonly selfCopy: WrapDelivery;
  readonly recipientCopy: WrapDelivery;
}

const toWrapDelivery = (
  wrapId: WrapDelivery["wrapId"],
  results: ReadonlyArray<RelayPublishResult>,
): WrapDelivery =>
  new WrapDelivery({
    wrapId,
    acceptedBy: results.filter((r) => r.accepted).map((r) => r.relay),
    rejectedBy: results
      .filter((r) => !r.accepted)
      .map((r) => new RelayRejection({ relay: r.relay, detail: r.detail })),
  });

export const deliverRumorToRecipient = (
  { identity, relayPolicy, transport }: GiftWrapDeliveryContext,
  params: {
    readonly rumor: Rumor;
    readonly recipient: Pubkey;
    readonly pushMark?: boolean;
    readonly senderSecretKey?: NostrSecretKey;
  },
): Effect.Effect<WrapDelivery> =>
  Effect.gen(function* () {
    const wrap = yield* Effect.sync(() =>
      wrapRumorFor(
        params.rumor,
        params.senderSecretKey ?? identity.secretKey,
        params.recipient,
        params.pushMark === true ? { pushMarker: true } : undefined,
      ),
    );
    const results = yield* transport.publish(relayPolicy.writeRelays, wrap);
    return toWrapDelivery(wrap.id, results);
  });

/**
 * NIP-17 delivery, shared by all verticals: the same rumor is wrapped twice —
 * once to self (cross-device echo), once to the peer — so both copies share
 * one rumor id. Success requires the recipient copy to be accepted by at
 * least one relay.
 *
 * With `order: "recipientFirst"` the copies publish sequentially: the self
 * copy is only attempted after a relay accepted the recipient copy, for
 * rumors whose self copy must never sync a state the recipient did not
 * receive. `order: "selfFirst"` is the mirror, for rumors that must never
 * reach the recipient without a record on the relay: the recipient copy is
 * only attempted after a relay accepted the self copy. A copy that was never
 * attempted is reported with no accepting or rejecting relays.
 */
export const deliverRumorToPeer = (
  { identity, relayPolicy, transport }: GiftWrapDeliveryContext,
  params: {
    readonly rumor: Rumor;
    readonly peer: Pubkey;
    readonly clientId: ClientId;
    readonly sentAt: UnixSeconds;
    readonly pushMarkRecipientCopy?: boolean;
    readonly order?: WrapDeliveryOrder;
  },
): Effect.Effect<DeliveredCopies, RecipientNotReached | NoRelayReachable> =>
  Effect.gen(function* () {
    const { clientId, peer, pushMarkRecipientCopy, rumor, sentAt } = params;
    const relays = relayPolicy.writeRelays;
    const [selfWrap, recipientWrap] = yield* Effect.all([
      Effect.sync(() =>
        wrapRumorFor(rumor, identity.secretKey, identity.pubkey),
      ),
      Effect.sync(() =>
        wrapRumorFor(
          rumor,
          identity.secretKey,
          peer,
          pushMarkRecipientCopy === true ? { pushMarker: true } : undefined,
        ),
      ),
    ]);

    const fail = (copies: DeliveredCopies) => {
      const failure = {
        rumorId: RumorId.make(rumor.id),
        clientId,
        sentAt,
        ...copies,
      };
      return copies.selfCopy.accepted
        ? new RecipientNotReached(failure)
        : new NoRelayReachable(failure);
    };

    const publishCopy = (wrap: SignedWrapEvent) =>
      Effect.map(transport.publish(relays, wrap), (results) =>
        toWrapDelivery(wrap.id, results),
      );
    const unattempted = (wrap: SignedWrapEvent) =>
      new WrapDelivery({ wrapId: wrap.id, acceptedBy: [], rejectedBy: [] });

    if (params.order === "recipientFirst") {
      const recipientCopy = yield* publishCopy(recipientWrap);
      if (!recipientCopy.accepted) {
        return yield* fail({ selfCopy: unattempted(selfWrap), recipientCopy });
      }
      return { selfCopy: yield* publishCopy(selfWrap), recipientCopy };
    }

    if (params.order === "selfFirst") {
      const selfCopy = yield* publishCopy(selfWrap);
      if (!selfCopy.accepted) {
        return yield* fail({
          selfCopy,
          recipientCopy: unattempted(recipientWrap),
        });
      }
      const recipientCopy = yield* publishCopy(recipientWrap);
      if (!recipientCopy.accepted)
        return yield* fail({ selfCopy, recipientCopy });
      return { selfCopy, recipientCopy };
    }

    const [selfCopy, recipientCopy] = yield* Effect.all(
      [publishCopy(selfWrap), publishCopy(recipientWrap)],
      { concurrency: "unbounded" },
    );
    const copies: DeliveredCopies = { selfCopy, recipientCopy };
    if (copies.recipientCopy.accepted) return copies;
    return yield* fail(copies);
  });
