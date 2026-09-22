export type ProofAction = "subscribe" | "unsubscribe";

export type NativePushPlatform = "android";

export interface WebPushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface WebPushSubscriptionData {
  endpoint: string;
  expirationTime: number | null;
  keys: WebPushSubscriptionKeys;
}

export interface NativePushSubscriptionData {
  platform: NativePushPlatform;
  token: string;
}

export interface OwnershipProofInput {
  pubkey: string;
  event: unknown;
}

export interface ChallengeRecord {
  nonce: string;
  pubkey: string;
  action: ProofAction;
  expiresAt: number;
  usedAt: number | null;
}

export interface StoredSubscription {
  id: number;
  endpoint: string;
  expirationTime: number | null;
  keys: WebPushSubscriptionKeys;
}

export interface StoredNativeSubscription {
  id: number;
  platform: NativePushPlatform;
  token: string;
}

export interface InboxNotificationData {
  type: "nostr_inbox";
  outerEventId: string;
  recipientPubkey: string;
  recipientNpub: string;
  createdAt: number;
}

/** A recurring payment is about to be due; the app must be opened to send it. */
export interface ReminderNotificationData {
  type: "recurring_reminder";
  recipientPubkey: string;
  recipientNpub: string;
  notifyAtSec: number;
}

export type PushNotificationData =
  | InboxNotificationData
  | ReminderNotificationData;

export interface StoredReminder {
  pubkey: string;
  notifyAtSec: number;
}

export interface PushNotificationEnvelope {
  title: string;
  body: string;
  data: PushNotificationData;
}

export interface SubscribeRequestBody {
  cleanupLegacySubscriptions: boolean;
  installationId: string | null;
  subscription: WebPushSubscriptionData;
  recipientPubkeys: string[];
  proofs: OwnershipProofInput[];
}

export interface NativeSubscribeRequestBody {
  cleanupLegacySubscriptions: boolean;
  installationId: string | null;
  device: NativePushSubscriptionData;
  recipientPubkeys: string[];
  proofs: OwnershipProofInput[];
}

export interface RemindersRequestBody {
  /** The one pubkey whose reminder set is replaced; mirrors the proof list. */
  recipientPubkeys: string[];
  notifyAtSecs: number[];
  proofs: OwnershipProofInput[];
}

export interface UnsubscribeRequestBody {
  endpoint: string;
  recipientPubkeys: string[];
  proofs: OwnershipProofInput[];
}

export interface NativeUnsubscribeRequestBody {
  token: string;
  recipientPubkeys: string[];
  proofs: OwnershipProofInput[];
}
