import { Effect } from "effect";
import type { WrapDelivery } from "../domain/delivery";
import { WrapNotDelivered } from "../domain/errors";
import type { NoRelayReachable, RecipientNotReached } from "../domain/errors";
import { RumorId } from "../domain/primitives";
import type {
  ClientId,
  NostrSecretKey,
  Pubkey,
  UnixSeconds,
} from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import type { InspectorService } from "../inspector/Inspector";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport } from "../services/NostrTransport";
import { RelayPolicy } from "../services/RelayPolicy";
import type { Rumor } from "./nostrEvent";
import { freshClientId, inspectOperation } from "./operations";
import type { OperationReceiptSummary } from "./operations";
import { nowSeconds } from "./time";
import { deliverRumorToPeer, deliverRumorToRecipient } from "./wrapDelivery";
import type { GiftWrapDeliveryContext } from "./wrapDelivery";

export interface WrapSendContext extends GiftWrapDeliveryContext {
  readonly inspector: InspectorService;
}

/** Everything a wrap-sending vertical needs from the environment. */
export const makeWrapSendContext: Effect.Effect<
  WrapSendContext,
  never,
  LinkstrIdentity | NostrTransport | RelayPolicy
> = Effect.all({
  identity: LinkstrIdentity,
  transport: NostrTransport,
  relayPolicy: RelayPolicy,
  inspector: Inspector.orNoop,
});

export interface PeerDraft {
  readonly to: Pubkey;
  /** Generated when omitted. */
  readonly clientId?: ClientId | undefined;
  /** Now when omitted. */
  readonly sentAt?: UnixSeconds | undefined;
}

export type RumorEncoder<Draft> = (
  draft: Draft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
) => Rumor;

/** What every two-copy send produces; verticals shape their receipt from it. */
export interface PeerSendOutcome {
  readonly rumorId: RumorId;
  readonly clientId: ClientId;
  readonly sentAt: UnixSeconds;
  readonly selfCopy: WrapDelivery;
  readonly recipientCopy: WrapDelivery;
}

interface PeerSent {
  readonly outcome: PeerSendOutcome;
  readonly rumor: Rumor;
}

export interface PeerSendSpec<Draft, Receipt> {
  readonly encode: RumorEncoder<Draft>;
  readonly receipt: (outcome: PeerSendOutcome, rumor: Rumor) => Receipt;
  readonly pushMarkRecipientCopy?: boolean;
  readonly order?: "parallel" | "recipientFirst";
}

/**
 * NIP-17 send to a peer, the skeleton every wrap vertical shares: fill in the
 * client id and timestamp, encode, deliver self and recipient copies, report
 * the outcome to the inspector under `name`, shape the receipt.
 */
export const sendToPeer = <Draft extends PeerDraft, Receipt>(
  context: WrapSendContext,
  name: string,
  draft: Draft,
  spec: PeerSendSpec<Draft, Receipt>,
): Effect.Effect<Receipt, RecipientNotReached | NoRelayReachable> =>
  Effect.gen(function* () {
    const clientId = draft.clientId ?? (yield* freshClientId);
    const sentAt = draft.sentAt ?? (yield* nowSeconds);
    const rumor = spec.encode(draft, context.identity.pubkey, sentAt, clientId);
    const copies = yield* deliverRumorToPeer(context, {
      rumor,
      peer: draft.to,
      clientId,
      sentAt,
      pushMarkRecipientCopy: spec.pushMarkRecipientCopy ?? false,
      order: spec.order ?? "parallel",
    });
    const sent: PeerSent = {
      outcome: { rumorId: RumorId.make(rumor.id), clientId, sentAt, ...copies },
      rumor,
    };
    return sent;
  }).pipe(
    inspectOperation(
      context.inspector,
      name,
      draft,
      (sent: PeerSent) => sent.outcome,
    ),
    Effect.map(({ outcome, rumor }) => spec.receipt(outcome, rumor)),
  );

/** Single-copy sibling of `PeerSendOutcome`: nothing is echoed to self. */
export interface RecipientSendOutcome {
  readonly rumorId: RumorId;
  readonly clientId: ClientId;
  readonly sentAt: UnixSeconds;
  readonly recipientCopy: WrapDelivery;
}

export interface RecipientSendSpec<Receipt> {
  readonly rumor: Rumor;
  readonly recipient: Pubkey;
  readonly clientId: ClientId;
  readonly sentAt: UnixSeconds;
  readonly pushMark?: boolean;
  /** Ephemeral author; defaults to the configured identity. */
  readonly senderSecretKey?: NostrSecretKey;
  readonly receipt: (outcome: RecipientSendOutcome) => Receipt;
}

const summarizeRecipientSend = (
  outcome: RecipientSendOutcome,
): OperationReceiptSummary => ({ ...outcome, selfCopy: null });

/**
 * Recipient-only send for rumors that must not sync to the sender's other
 * devices; fails unless a relay accepted the copy.
 */
export const sendToRecipient = <Receipt>(
  context: WrapSendContext,
  name: string,
  params: unknown,
  spec: RecipientSendSpec<Receipt>,
): Effect.Effect<Receipt, WrapNotDelivered> =>
  Effect.gen(function* () {
    const recipientCopy = yield* deliverRumorToRecipient(context, {
      rumor: spec.rumor,
      recipient: spec.recipient,
      pushMark: spec.pushMark ?? false,
      senderSecretKey: spec.senderSecretKey ?? context.identity.secretKey,
    });
    const outcome: RecipientSendOutcome = {
      rumorId: RumorId.make(spec.rumor.id),
      clientId: spec.clientId,
      sentAt: spec.sentAt,
      recipientCopy,
    };
    if (!recipientCopy.accepted) {
      return yield* new WrapNotDelivered(outcome);
    }
    return outcome;
  }).pipe(
    inspectOperation(context.inspector, name, params, summarizeRecipientSend),
    Effect.map(spec.receipt),
  );
