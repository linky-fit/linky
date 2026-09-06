import type { ContactId, ContactRow } from "../../evolu";
import type { I18nKey } from "../../i18n";
import type {
  PaymentTelemetryAppRuntime,
  PaymentTelemetryDevicePlatform,
} from "@linky/linkstr";
import type { JsonValue } from "../../types/json";

export type PaymentTelemetryStatus = "declined" | "error" | "ok";

export type LocalPaymentEvent = {
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
};

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

export type LoggedPaymentEventParams = {
  amount?: number | null;
  contactId?: ContactId | string | null;
  details?: JsonValue | null;
  direction: "in" | "out";
  error?: string | null;
  fee?: number | null;
  method?: PaymentTelemetryMethod | null;
  mint?: string | null;
  note?: string | null;
  phase?: PaymentTelemetryPhase | null;
  status: PaymentTelemetryStatus;
  unit?: string | null;
};

export type LocalPaymentTelemetryEvent = {
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
  id: string;
  method: PaymentTelemetryMethod;
  mint: string | null;
  phase: PaymentTelemetryPhase;
  status: PaymentTelemetryStatus;
};

export type LocalNostrMessage = {
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
};

export type LocalNostrReaction = {
  clientId?: string;
  createdAtSec: number;
  emoji: string;
  id: string;
  messageId: string;
  reactorPubkey: string;
  status?: "sent" | "pending";
  wrapId: string;
};

export type LocalPendingPayment = {
  amountSat: number;
  contactId: string;
  createdAtSec: number;
  id: string;
  messageId?: string;
};

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
  [K in keyof ContactRow]?: ContactDisplayValue<ContactRow[K]> | null;
} & { isUnknownContact?: boolean };
export type ContactIdentityRowLike = Pick<
  ContactRowLike,
  "id" | "npub" | "ownerId"
> & { unknownPubkeyHex?: string | null };
export type ContactNameRowLike = Pick<
  ContactRowLike,
  "archivedAtSec" | "createdAt" | "id" | "isUnknownContact" | "name"
>;
export type ContactPayRowLike = Pick<
  ContactRowLike,
  "id" | "lnAddress" | "name"
>;

export type RouteWithOptionalId = {
  id?: ContactIdLike;
  kind: string;
  offerId?: string;
};

type MintSupportsMppValue = OptionalBooleanTextNumber;

export type LocalMintInfoRow = {
  feesJson?: string | null | undefined;
  firstSeenAtSec?: number | null | undefined;
  id: string;
  infoJson?: string | null | undefined;
  isDeleted?: OptionalBooleanTextNumber;
  lastCheckedAtSec?: number | null | undefined;
  lastSeenAtSec?: number | null | undefined;
  supportsMpp?: MintSupportsMppValue;
  url: string;
};

export type ContactsGuideKey =
  | "add_contact"
  | "topup"
  | "pay"
  | "message"
  | "backup_keys";

export type ContactsGuideStep = {
  bodyKey: I18nKey;
  ensure?: () => void;
  id: string;
  selector: string;
  titleKey: I18nKey;
};

export type ContactFormState = {
  groups: string[];
  lnAddress: string;
  name: string;
  npub: string;
};

export type CashuTokenMeta = {
  amount: number | null;
  mint: string | null;
  tokenText: string;
  unit: string | null;
};

export type TopbarButton = {
  icon: string;
  label: string;
  onClick: () => void;
};

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

export type UpdateLocalNostrMessage = (
  id: string,
  updates: Partial<UpdateLocalNostrMessageFields>,
) => void;

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

export type UpdateLocalNostrReaction = (
  id: string,
  updates: Partial<UpdateLocalNostrReactionFields>,
) => void;

export type ChatReactionChip = {
  count: number;
  emoji: string;
  reactedByMe: boolean;
};
