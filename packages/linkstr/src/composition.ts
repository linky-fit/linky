import { Layer } from "effect";
import { AppData } from "./appData/AppData";
import { AppMessages } from "./appMessages/AppMessages";
import { BankOffers } from "./bankOffers/BankOffers";
import { Chat } from "./chat/Chat";
import type { NostrSecretKey, RelayUrl } from "./domain/primitives";
import { InboxCursorStore } from "./inbox/InboxCursorStore";
import { WrapInbox } from "./inbox/WrapInbox";
import { MuteList } from "./muteList/MuteList";
import { NostrConnect } from "./nostrConnect/NostrConnect";
import { Outbox } from "./outbox/Outbox";
import { OutboxStore } from "./outbox/OutboxStore";
import { PaymentNotices } from "./paymentNotices/PaymentNotices";
import { PaymentTelemetry } from "./paymentTelemetry/PaymentTelemetry";
import { Profiles } from "./profiles/Profiles";
import { ProfileWatch } from "./profiles/ProfileWatch";
import { Reactions } from "./reactions/Reactions";
import { RelayLists } from "./relayLists/RelayLists";
import { SeenReceipts } from "./seenReceipts/SeenReceipts";
import { LinkstrIdentity } from "./services/LinkstrIdentity";
import type { NostrTransport } from "./services/NostrTransport";
import { RelayPolicy } from "./services/RelayPolicy";

export interface LinkstrServicesConfig {
  readonly secretKey: NostrSecretKey;
  readonly readRelays: ReadonlyArray<RelayUrl>;
  readonly writeRelays: ReadonlyArray<RelayUrl>;
  /**
   * Taken as-is: the composition root decorates it first (inspector/health
   * taps, test fakes) when it wants observability.
   */
  readonly transport: Layer.Layer<NostrTransport>;
  /** Durable outbox job storage; defaults to non-durable in-memory storage. */
  readonly outboxStore?: Layer.Layer<OutboxStore> | undefined;
  /** Durable inbox cursor storage; defaults to non-durable in-memory storage. */
  readonly inboxCursorStore?: Layer.Layer<InboxCursorStore> | undefined;
}

/**
 * The one place that knows how to assemble the vertical services over the
 * base services (identity, relay policy, transport). Composition roots layer
 * their own environment on top: the react runtime merges inspector and relay
 * health, the headless runner provides the result per call.
 */
export const linkstrServices = (config: LinkstrServicesConfig) =>
  Layer.mergeAll(
    AppData.Default,
    AppMessages.Default,
    BankOffers.Default,
    Chat.Default,
    Outbox.Default.pipe(
      Layer.provide([
        Chat.Default,
        Reactions.Default,
        PaymentTelemetry.Default,
        AppMessages.Default,
        config.outboxStore ?? OutboxStore.inMemory,
      ]),
    ),
    PaymentNotices.Default,
    PaymentTelemetry.Default,
    Reactions.Default,
    SeenReceipts.Default,
    WrapInbox.Default.pipe(
      Layer.provide(config.inboxCursorStore ?? InboxCursorStore.inMemory),
    ),
    Profiles.Default,
    ProfileWatch.Default,
    RelayLists.Default,
    MuteList.Default,
    NostrConnect.Default,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        LinkstrIdentity.fromSecretKey(config.secretKey),
        RelayPolicy.fixed({
          readRelays: config.readRelays,
          writeRelays: config.writeRelays,
        }),
        config.transport,
      ),
    ),
  );

/** Everything `linkstrServices` provides. */
export type LinkstrServices = Layer.Layer.Success<
  ReturnType<typeof linkstrServices>
>;
