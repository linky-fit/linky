import { encodeNpub, Pubkey } from "@linky/linkstr";

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

interface ReminderDispatcherOptions {
  storage: PushStorage;
  pushDelivery: PushDelivery;
  intervalMs?: number;
}

export const REMINDER_DISPATCH_INTERVAL_MS = 15 * 1000;

// The guard accepted 64 hex chars; a value that is not a curve point cannot
// be encoded and would never have a subscription anyway.
const readPubkey = (value: string): Pubkey | null => {
  try {
    return Pubkey.make(value);
  } catch {
    return null;
  }
};
/** A reminder this far past its time is dropped instead of sent late. */
export const REMINDER_STALE_AFTER_SECONDS = 60 * 60;

/**
 * Sends "a recurring payment is ready" pushes at the times the app
 * registered. The service knows only that a pubkey wants a nudge at a
 * moment; amounts and recipients never leave the device.
 */
export class ReminderDispatcher {
  private readonly storage: PushStorage;
  private readonly pushDelivery: PushDelivery;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<number> | null = null;

  constructor(options: ReminderDispatcherOptions) {
    this.storage = options.storage;
    this.pushDelivery = options.pushDelivery;
    this.intervalMs = options.intervalMs ?? REMINDER_DISPATCH_INTERVAL_MS;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.dispatch(Date.now());
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }

  /** One pass: takes every due reminder and delivers it; returns how many were sent to at least one device. */
  dispatch(nowMs: number): Promise<number> {
    if (this.inFlight !== null) return this.inFlight;
    const pass = this.dispatchDue(nowMs).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = pass;
    return pass;
  }

  private async dispatchDue(nowMs: number): Promise<number> {
    const nowSec = Math.floor(nowMs / 1000);
    const due = this.storage.takeDueReminders(
      nowSec,
      nowSec - REMINDER_STALE_AFTER_SECONDS,
    );
    let delivered = 0;
    for (const reminder of due) {
      const recipient = readPubkey(reminder.pubkey);
      if (recipient === null) continue;
      const subscriptions =
        this.storage
          .getSubscriptionsForPubkeys([reminder.pubkey])
          .get(reminder.pubkey) ?? [];
      const nativeSubscriptions =
        this.storage
          .getNativeSubscriptionsForPubkeys([reminder.pubkey])
          .get(reminder.pubkey) ?? [];
      if (subscriptions.length === 0 && nativeSubscriptions.length === 0) {
        console.debug(
          `[push] skipped reminder without matching subscriptions notifyAt=${reminder.notifyAtSec}`,
        );
        continue;
      }
      const payloadData: PushNotificationData = {
        type: "recurring_reminder",
        recipientPubkey: recipient,
        recipientNpub: encodeNpub(recipient),
        notifyAtSec: reminder.notifyAtSec,
      };
      const deliveries: Array<Promise<void>> = [
        ...subscriptions.map((subscription) =>
          this.pushDelivery
            .deliverWeb(subscription, payloadData)
            .catch((error) => {
              console.warn(
                `[push] failed to deliver reminder notifyAt=${reminder.notifyAtSec}`,
                error instanceof Error
                  ? error.message
                  : "Unknown delivery error",
              );
            }),
        ),
        ...nativeSubscriptions.map((subscription) =>
          this.pushDelivery
            .deliverNative(subscription, payloadData)
            .catch((error) => {
              console.warn(
                `[push] failed to deliver native reminder notifyAt=${reminder.notifyAtSec}`,
                error,
              );
            }),
        ),
      ];
      await Promise.all(deliveries);
      delivered += 1;
    }
    return delivered;
  }
}
