import type { IconName } from "@linky-fit/ui";
import type { TransactionId } from "@linky-fit/linksync";
import type { ContactId } from "../../evolu";
import type { ContactWithChatState } from "../lib/contactChatState";
import type { WriteOutcome } from "../lib/storeWrite";
import type { I18nKey } from "../../i18n";
import type { ProfileStatusCurrency } from "../../nostrStatus";
import type {
  Pubkey,
  PaymentTelemetryAppRuntime,
  PaymentTelemetryDevicePlatform,
  PaymentTelemetryFlow,
} from "@linky-fit/linkstr";
import type { JsonValue } from "../../types/json";

export type PaymentTelemetryStatus = "declined" | "error" | "ok";

export interface LocalPaymentEvent {
  amount: number | null;
  contactId: string | null;
  createdAtSec: number;
  direction: "in" | "out";
  error: string | null;
  fee: number | null;
  id: string;
  method?: PaymentTelemetryMethod | null;
  mint: string | null;
  phase?: PaymentTelemetryPhase | null;
  status: PaymentTelemetryStatus;
  unit: string | null;
}

export type PaymentTelemetryMethod =
  | "cashu_chat"
  | "cashu_receive"
  | "cashu_restore"
  | "lightning_address"
  | "lightning_invoice"
  | "unknown";

export type PaymentTelemetryPhase =
  | "complete"
  | "invoice_fetch"
  | "melt"
  | "publish"
  | "receive"
  | "restore"
  | "swap"
  | "unknown";

interface PaymentEventFields {
  amount?: number | null;
  contactId?: ContactId | string | null;
  details?: JsonValue | null;
  direction: "in" | "out";
  error?: string | null;
  fee?: number | null;
  /** The Linky flow the payment belongs to; left out for an ordinary payment. */
  flow?: PaymentTelemetryFlow | null;
  method?: PaymentTelemetryMethod | null;
  mint?: string | null;
  /** The payment's note: bolt11 description, token memo, LNURL comment or request description. */
  note?: string | null;
  phase?: PaymentTelemetryPhase | null;
  unit?: string | null;
}

/** A payment that happened or is in flight is recorded under its event's id; a failure only reaches telemetry. */
export type LoggedPaymentEventParams = PaymentEventFields &
  (
    | { status: "ok"; transactionId: TransactionId }
    | { status: "declined" | "error"; transactionId?: never }
  );

export interface LocalPaymentTelemetryEvent {
  amountBucket: string | null;
  appHost?: string | null;
  appRuntime?: PaymentTelemetryAppRuntime | null;
  appVersion: string;
  createdAtSec: number;
  devicePlatform?: PaymentTelemetryDevicePlatform | null;
  direction: "in" | "out";
  errorCode: string | null;
  errorDetail: string | null;
  feeBucket: string | null;
  flow?: PaymentTelemetryFlow | null;
  id: string;
  method: PaymentTelemetryMethod;
  mint: string | null;
  phase: PaymentTelemetryPhase;
  status: PaymentTelemetryStatus;
}

export interface LocalNostrMessage {
  clientId?: string;
  contactId: string;
  content: string;
  createdAtSec: number;
  direction: "in" | "out";
  editedAtSec?: number | null;
  editedFromId?: string | null;
  id: string;
  isEdited?: boolean;
  localOnly?: boolean;
  originalContent?: string | null;
  pubkey: string;
  replyToContent?: string | null;
  replyToId?: string | null;
  rootMessageId?: string | null;
  rumorId: string | null;
  status?: "sent" | "pending";
  wrapId: string;
}

export interface LocalNostrReaction {
  clientId?: string;
  createdAtSec: number;
  emoji: string;
  id: string;
  messageId: string;
  reactorPubkey: string;
  status?: "sent" | "pending";
  wrapId: string;
}

export interface LocalPendingPayment {
  recipientPubkey?: Pubkey;
  amountSat: number;
  contactId: string;
  createdAtSec: number;
  id: string;
  messageId?: string;
}

export type OptionalBooleanTextNumber =
  | boolean
  | string
  | number
  | null
  | undefined;
export type ContactIdLike = ContactId | string | null | undefined;

type PaymentLogField = JsonValue;
export type PaymentLogData = Record<string, PaymentLogField>;

type ContactDisplayValue<T> = T extends string
  ? string
  : T extends number
    ? number
    : T;
// Display rows also include unsaved Nostr contacts and selected contact fields.
export type ContactRowLike = {
  [K in keyof ContactWithChatState]?: ContactDisplayValue<
    ContactWithChatState[K]
  > | null;
} & { isUnknownContact?: boolean };
/** A contact whose status advertises the currencies they pay transfers in. */
export interface ProxyPaymentPayerContact {
  contact: ContactRowLike;
  currencies: ProfileStatusCurrency[];
  pictureUrl: string | null;
}
export type ContactIdentityRowLike = Pick<ContactRowLike, "id" | "npub"> & {
  unknownPubkeyHex?: string | null;
};
export type ContactNameRowLike = Pick<
  ContactRowLike,
  "archivedAtSec" | "createdAt" | "id" | "isUnknownContact" | "name"
>;
export type ContactPayRowLike = Pick<
  ContactRowLike,
  "id" | "lnAddress" | "name"
>;

export interface RouteWithOptionalId {
  id?: ContactIdLike;
  kind: string;
  offerId?: string;
}

type MintSupportsMppValue = OptionalBooleanTextNumber;

export interface LocalMintInfoRow {
  feesJson?: string | null | undefined;
  firstSeenAtSec?: number | null | undefined;
  id: string;
  infoJson?: string | null | undefined;
  isDeleted?: OptionalBooleanTextNumber;
  lastCheckedAtSec?: number | null | undefined;
  lastSeenAtSec?: number | null | undefined;
  supportsMpp?: MintSupportsMppValue;
  url: string;
}

export type ContactsGuideKey =
  | "add_contact"
  | "topup"
  | "pay"
  | "message"
  | "backup_keys";

export interface ContactsGuideStep {
  bodyKey: I18nKey;
  ensure?: () => void;
  id: string;
  selector: string;
  titleKey: I18nKey;
}

export interface ContactFormState {
  groups: string[];
  lnAddress: string;
  name: string;
  npub: string;
}

export interface TopbarButton {
  icon: IconName;
  isActive?: boolean;
  label: string;
  onClick: () => void;
}

export type NewLocalNostrMessage = Omit<LocalNostrMessage, "id" | "status"> & {
  status?: "sent" | "pending";
};

type UpdateLocalNostrMessageFields = Pick<
  LocalNostrMessage,
  | "clientId"
  | "content"
  | "createdAtSec"
  | "editedAtSec"
  | "editedFromId"
  | "isEdited"
  | "localOnly"
  | "originalContent"
  | "pubkey"
  | "replyToContent"
  | "replyToId"
  | "rootMessageId"
  | "rumorId"
  | "status"
  | "wrapId"
>;

/** A row handed to the store: its id at once, and its write's outcome once stored. */
export interface AppendedRow {
  readonly id: string;
  readonly written: Promise<WriteOutcome>;
}

export type AppendLocalNostrMessage = (
  message: NewLocalNostrMessage,
) => AppendedRow;

export type UpdateLocalNostrMessage = (
  id: string,
  updates: Partial<UpdateLocalNostrMessageFields>,
) => Promise<WriteOutcome>;

export type NewLocalNostrReaction = Omit<
  LocalNostrReaction,
  "id" | "status"
> & {
  status?: "sent" | "pending";
};

type UpdateLocalNostrReactionFields = Pick<
  LocalNostrReaction,
  "clientId" | "emoji" | "messageId" | "reactorPubkey" | "status" | "wrapId"
>;

export type AppendLocalNostrReaction = (
  reaction: NewLocalNostrReaction,
) => AppendedRow;

export type UpdateLocalNostrReaction = (
  id: string,
  updates: Partial<UpdateLocalNostrReactionFields>,
) => Promise<WriteOutcome>;

export interface ChatReactionChip {
  count: number;
  emoji: string;
  reactedByMe: boolean;
}
