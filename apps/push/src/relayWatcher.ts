import { encodeNpub, RelayUrl, watchPushInbox } from "@linky/linkstr";
import type { DeliveredPushWrap, PushInboxSubscription } from "@linky/linkstr";

import {
  CATCH_UP_LOOKBACK_SECONDS,
  SEEN_EVENT_RETENTION_MARGIN_MS,
} from "./config";
import { PushStorage } from "./storage";
import type {
  PushNotificationData,
  StoredNativeSubscription,
  StoredSubscription,
} from "./types";

interface PushDelivery {
  deliverWeb(
    subscription: StoredSubscription,
    payloadData: PushNotificationData,
  ): Promise<void>;
  deliverNative(
    subscription: StoredNativeSubscription,
    payloadData: PushNotificationData,
  ): Promise<void>;
}

interface RelayWatcherOptions {
  relayUrls: string[];
  storage: PushStorage;
  pushDelivery: PushDelivery;
}

export class RelayWatcher {
  private readonly relayUrls: ReadonlyArray<RelayUrl>;
  private readonly storage: PushStorage;
  private readonly pushDelivery: PushDelivery;
  private subscription: PushInboxSubscription | null = null;

  constructor(options: RelayWatcherOptions) {
    this.relayUrls = options.relayUrls.map((url) => RelayUrl.make(url));
    this.storage = options.storage;
    this.pushDelivery = options.pushDelivery;
  }

  start(): void {
    if (this.subscription !== null) return;
    console.info(
      `[push] opening linkstr relay watcher with ${CATCH_UP_LOOKBACK_SECONDS}s lookback`,
    );
    this.subscription = watchPushInbox(
      {
        readRelays: this.relayUrls,
        allowInsecureLocalhost:
          process.env.PUSH_ALLOW_INSECURE_LOCALHOST_RELAYS === "1",
        lookbackSeconds: CATCH_UP_LOOKBACK_SECONDS,
        onInvalidWrap: (failure) =>
          console.warn(`[push] invalid push wrap failure=${failure}`),
        onRelayStatus: (event) => {
          if (event.type === "eose") {
            console.info(
              `[push] relay caught up; live delivery enabled relay=${event.relay}`,
            );
            return;
          }
          console.warn(
            `[push] relay subscription attempt ended relay=${event.relay} reason=${event.reason}`,
          );
        },
        onFatal: (message) =>
          console.error(`[push] relay watcher failed\n${message}`),
      },
      (event) => void this.handleDelivered(event),
    );
  }

  async stop(): Promise<void> {
    await this.subscription?.close();
    this.subscription = null;
  }

  pruneSeen(nowMs: number): void {
    this.storage.pruneSeenEvents(
      nowMs,
      CATCH_UP_LOOKBACK_SECONDS * 1000 + SEEN_EVENT_RETENTION_MARGIN_MS,
    );
  }

  async handleDelivered({ delivery, wrap }: DeliveredPushWrap): Promise<void> {
    const recipient = wrap.recipient;
    const subscriptions =
      this.storage.getSubscriptionsForPubkeys([recipient]).get(recipient) ?? [];
    const nativeSubscriptions =
      this.storage
        .getNativeSubscriptionsForPubkeys([recipient])
        .get(recipient) ?? [];
    if (subscriptions.length === 0 && nativeSubscriptions.length === 0) {
      console.debug(
        `[push] skipped event without matching subscriptions id=${wrap.wrapId} recipient=${recipient}`,
      );
      return;
    }

    if (delivery === "backfill") {
      console.debug(
        `[push] suppressed historical gift wrap id=${wrap.wrapId} recipient=${recipient}`,
      );
      return;
    }

    const nowMs = Date.now();
    if (!this.storage.recordSeenEvent(wrap.wrapId, nowMs)) {
      console.debug(`[push] skipped duplicate event id=${wrap.wrapId}`);
      return;
    }

    console.debug(
      `[push] observed gift wrap id=${wrap.wrapId} recipient=${recipient} createdAt=${wrap.createdAt}`,
    );
    console.debug(
      `[push] delivering gift wrap id=${wrap.wrapId} recipient=${recipient} webSubscriptions=${subscriptions.length} nativeSubscriptions=${nativeSubscriptions.length}`,
    );
    const payloadData: PushNotificationData = {
      type: "nostr_inbox",
      outerEventId: wrap.wrapId,
      recipientPubkey: recipient,
      recipientNpub: encodeNpub(recipient),
      createdAt: wrap.createdAt,
    };
    const deliveries: Array<Promise<void>> = [];

    for (const subscription of subscriptions) {
      deliveries.push(
        this.pushDelivery
          .deliverWeb(subscription, payloadData)
          .catch((error) => {
            console.warn(
              `[push] failed to deliver ${wrap.wrapId} to ${recipient}`,
              error instanceof Error ? error.message : "Unknown delivery error",
            );
          }),
      );
    }
    for (const subscription of nativeSubscriptions) {
      deliveries.push(
        this.pushDelivery
          .deliverNative(subscription, payloadData)
          .catch((error) => {
            console.warn(
              `[push] failed to deliver native ${wrap.wrapId} to ${recipient}`,
              error,
            );
          }),
      );
    }

    await Promise.allSettled(deliveries);
  }
}
