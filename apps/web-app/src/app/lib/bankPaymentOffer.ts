import { Option, Schema } from "effect";
import type { Translate } from "../../i18n";
import { NonBlankString, PositiveFiniteNumber } from "../../utils/schema";
import {
  safeLocalStorageGetJson,
  safeLocalStorageKeys,
  safeLocalStorageRemove,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import { nowSeconds } from "../../utils/time";
import { asNonEmptyString } from "../../utils/validation";
import type { LocalNostrMessage } from "../types/appTypes";

export const LINKY_BANK_PAYMENT_OFFER_PHASE_TTL_SEC = 5 * 60;
export const LINKY_BANK_PAYMENT_OFFER_DEFAULT_RECIPIENT_COUNT = 2;
export const LINKY_BANK_PAYMENT_OFFER_MIN_RECIPIENT_COUNT = 1;
export const LINKY_BANK_PAYMENT_OFFER_MAX_RECIPIENT_COUNT = 10;
export const LINKY_BANK_PAYMENT_OFFER_DEFAULT_STAGGER_DELAY_SEC = 0;
export const LINKY_BANK_PAYMENT_OFFER_MIN_STAGGER_DELAY_SEC = 0;
export const LINKY_BANK_PAYMENT_OFFER_MAX_STAGGER_DELAY_SEC = 30;
export const LINKY_BANK_PAYMENT_OFFER_STAGGER_DELAY_STEP_SEC = 5;
const LINKY_BANK_PAYMENT_OFFER_MINIMIZED_STORAGE_KEY_PREFIX =
  "linky.bank_payment_offer_minimized.v1";
const LINKY_BANK_PAYMENT_OFFER_SPD_STORAGE_KEY_PREFIX =
  "linky.bank_payment_offer_spd.v1";
const LINKY_BANK_PAYMENT_OFFER_SPD_MAX_AGE_SEC = 60 * 60;
export const LINKY_BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX =
  "linky.bank_payment_offer_details_lock.v1";
const LINKY_BANK_PAYMENT_OFFER_STAGGER_STORAGE_KEY_PREFIX =
  "linky.bank_payment_offer_stagger.v1";
export const LINKY_BANK_PAYMENT_OFFER_STAGGER_LOCK_KEY_PREFIX =
  "linky.bank_payment_offer_stagger_lock.v1";

const LinkyBankPaymentOfferStatus = Schema.Literal(
  "accepted",
  "accepted_by_other",
  "bank_details_sent",
  "bank_paid",
  "canceled",
  "declined",
  "offered",
  "settled",
);
export type LinkyBankPaymentOfferStatus =
  typeof LinkyBankPaymentOfferStatus.Type;

export interface LinkyBankPaymentOfferInfo {
  amountSat: number | null;
  amountText: string;
  bankPaidAtSec: number | null;
  expiresAtSec: number | null;
  extensionSec: number | null;
  initiatedAtSec: number | null;
  offerId: string;
  offererPublicKey: string | null;
  spdPayload: string | null;
  status: LinkyBankPaymentOfferStatus;
  statusUpdatedAtSec: number | null;
  text: string;
}

export const getLinkyBankPaymentOfferExpiresAtSec = (
  offerInfo: LinkyBankPaymentOfferInfo,
  createdAtSec: number,
): number | null => {
  if (isLinkyBankPaymentOfferTerminalStatus(offerInfo.status)) return null;
  if (offerInfo.expiresAtSec && offerInfo.expiresAtSec > 0) {
    return offerInfo.expiresAtSec;
  }

  const phaseStartedAtSecRaw =
    offerInfo.statusUpdatedAtSec && offerInfo.statusUpdatedAtSec > 0
      ? offerInfo.statusUpdatedAtSec
      : createdAtSec;
  if (!Number.isFinite(phaseStartedAtSecRaw) || phaseStartedAtSecRaw <= 0) {
    return null;
  }
  return (
    Math.trunc(phaseStartedAtSecRaw) + LINKY_BANK_PAYMENT_OFFER_PHASE_TTL_SEC
  );
};

export const isLinkyBankPaymentOfferExpired = (
  offerInfo: LinkyBankPaymentOfferInfo,
  createdAtSec: number,
  nowSec: number,
): boolean => {
  if (isLinkyBankPaymentOfferTerminalStatus(offerInfo.status)) return false;

  const expiresAtSec = getLinkyBankPaymentOfferExpiresAtSec(
    offerInfo,
    createdAtSec,
  );
  return expiresAtSec === null ? false : nowSec >= expiresAtSec;
};

const getMinimizedOfferStorageKey = (chatId: string, offerId: string): string =>
  `${LINKY_BANK_PAYMENT_OFFER_MINIMIZED_STORAGE_KEY_PREFIX}.${encodeURIComponent(chatId)}.${encodeURIComponent(offerId)}`;

export const isLinkyBankPaymentOfferMinimized = (
  chatId: string,
  offerId: string,
): boolean => {
  try {
    return (
      window.sessionStorage.getItem(
        getMinimizedOfferStorageKey(chatId, offerId),
      ) === "1"
    );
  } catch {
    return false;
  }
};

export const setLinkyBankPaymentOfferMinimized = (
  chatId: string,
  offerId: string,
  minimized: boolean,
): void => {
  try {
    const key = getMinimizedOfferStorageKey(chatId, offerId);
    if (minimized) {
      window.sessionStorage.setItem(key, "1");
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }
};

const LinkyBankPaymentOfferSpdRecord = Schema.Struct({
  createdAtSec: PositiveFiniteNumber,
  ownerPubkey: Schema.String,
  sentCandidateKeys: Schema.Array(Schema.String),
  spdPayload: NonBlankString,
});
type LinkyBankPaymentOfferSpdRecord =
  typeof LinkyBankPaymentOfferSpdRecord.Type;

// One storage key per offer so concurrent tabs working on different offers
// never overwrite each other's records.
const getSpdRecordStorageKey = (offerId: string): string =>
  `${LINKY_BANK_PAYMENT_OFFER_SPD_STORAGE_KEY_PREFIX}.${encodeURIComponent(offerId)}`;

// A future createdAtSec (backward clock jump) also counts as expired so a
// record can never outlive the intended one-hour window.
const isExpiredSpdRecord = (
  record: LinkyBankPaymentOfferSpdRecord,
  nowSec: number,
): boolean =>
  record.createdAtSec > nowSec ||
  nowSec - record.createdAtSec >= LINKY_BANK_PAYMENT_OFFER_SPD_MAX_AGE_SEC;

const readSpdRecordByStorageKey = (
  storageKey: string,
): LinkyBankPaymentOfferSpdRecord | null =>
  safeLocalStorageGetJson(
    storageKey,
    Schema.NullOr(LinkyBankPaymentOfferSpdRecord),
    null,
  );

const writeSpdRecord = (
  offerId: string,
  record: LinkyBankPaymentOfferSpdRecord,
): void => {
  safeLocalStorageSetJson(getSpdRecordStorageKey(offerId), record);
};

const pruneExpiredSpdRecords = (nowSec: number): void => {
  for (const key of safeLocalStorageKeys()) {
    if (
      !key.startsWith(`${LINKY_BANK_PAYMENT_OFFER_SPD_STORAGE_KEY_PREFIX}.`)
    ) {
      continue;
    }
    const record = readSpdRecordByStorageKey(key);
    if (!record || isExpiredSpdRecord(record, nowSec)) {
      safeLocalStorageRemove(key);
    }
  }
};

export const rememberLinkyBankPaymentOfferSpdPayload = (args: {
  offerId: string;
  ownerPubkey: string;
  spdPayload: string;
}): void => {
  const offerId = args.offerId.trim();
  const spdPayload = args.spdPayload.trim();
  if (!offerId || !spdPayload) return;

  const nowSec = nowSeconds();
  pruneExpiredSpdRecords(nowSec);
  writeSpdRecord(offerId, {
    createdAtSec: nowSec,
    ownerPubkey: args.ownerPubkey,
    sentCandidateKeys: [],
    spdPayload,
  });
};

export const readLinkyBankPaymentOfferSpdRecord = (args: {
  offerId: string;
  ownerPubkey: string;
}): LinkyBankPaymentOfferSpdRecord | null => {
  const record = readSpdRecordByStorageKey(
    getSpdRecordStorageKey(args.offerId),
  );
  if (!record) return null;
  // Delete rather than just hide an expired record so a later clock
  // correction cannot bring it back to life.
  if (isExpiredSpdRecord(record, nowSeconds())) {
    forgetLinkyBankPaymentOfferSpdPayload(args.offerId);
    return null;
  }
  if (record.ownerPubkey !== args.ownerPubkey) return null;
  return record;
};

export const markLinkyBankPaymentOfferBankDetailsSent = (args: {
  candidateKey: string;
  offerId: string;
}): void => {
  const record = readSpdRecordByStorageKey(
    getSpdRecordStorageKey(args.offerId),
  );
  if (!record || record.sentCandidateKeys.includes(args.candidateKey)) return;
  writeSpdRecord(args.offerId, {
    ...record,
    sentCandidateKeys: [...record.sentCandidateKeys, args.candidateKey],
  });
};

export const forgetLinkyBankPaymentOfferSpdPayload = (
  offerId: string,
): void => {
  safeLocalStorageRemove(getSpdRecordStorageKey(offerId));
};

const LinkyBankPaymentOfferStaggerRecipient = Schema.Struct({
  contactId: NonBlankString,
  contactPubHex: NonBlankString,
  dueAtSec: PositiveFiniteNumber,
});

const LinkyBankPaymentOfferStaggerRecord = Schema.Struct({
  amountSat: Schema.NullOr(PositiveFiniteNumber),
  amountText: NonBlankString,
  createdAtSec: PositiveFiniteNumber,
  expiresAtSec: PositiveFiniteNumber,
  offerId: NonBlankString,
  ownerPubkey: NonBlankString,
  pending: Schema.Array(LinkyBankPaymentOfferStaggerRecipient),
});
export type LinkyBankPaymentOfferStaggerRecord =
  typeof LinkyBankPaymentOfferStaggerRecord.Type;

const getStaggerRecordStorageKey = (offerId: string): string =>
  `${LINKY_BANK_PAYMENT_OFFER_STAGGER_STORAGE_KEY_PREFIX}.${encodeURIComponent(offerId)}`;

// A future createdAtSec (backward clock jump) counts as expired for the same
// reason as the SPD record: the queue must never outlive the offered phase.
const isExpiredStaggerRecord = (
  record: LinkyBankPaymentOfferStaggerRecord,
  nowSec: number,
): boolean => record.createdAtSec > nowSec || nowSec >= record.expiresAtSec;

const readStaggerRecordByStorageKey = (
  storageKey: string,
): LinkyBankPaymentOfferStaggerRecord | null =>
  safeLocalStorageGetJson(
    storageKey,
    Schema.NullOr(LinkyBankPaymentOfferStaggerRecord),
    null,
  );

export const forgetLinkyBankPaymentOfferStaggerQueue = (
  offerId: string,
): void => {
  safeLocalStorageRemove(getStaggerRecordStorageKey(offerId));
};

export const rememberLinkyBankPaymentOfferStaggerQueue = (
  record: LinkyBankPaymentOfferStaggerRecord,
): void => {
  if (!record.offerId.trim() || record.pending.length === 0) return;
  safeLocalStorageSetJson(getStaggerRecordStorageKey(record.offerId), record);
};

export const readLinkyBankPaymentOfferStaggerRecords = (
  ownerPubkey: string,
): LinkyBankPaymentOfferStaggerRecord[] => {
  const records: LinkyBankPaymentOfferStaggerRecord[] = [];
  const nowSec = nowSeconds();
  for (const key of safeLocalStorageKeys()) {
    if (
      !key.startsWith(`${LINKY_BANK_PAYMENT_OFFER_STAGGER_STORAGE_KEY_PREFIX}.`)
    ) {
      continue;
    }
    const record = readStaggerRecordByStorageKey(key);
    if (!record || isExpiredStaggerRecord(record, nowSec)) {
      safeLocalStorageRemove(key);
      continue;
    }
    if (record.ownerPubkey === ownerPubkey) records.push(record);
  }
  return records;
};

export const removeLinkyBankPaymentOfferStaggerRecipients = (
  offerId: string,
  contactIds: readonly string[],
): void => {
  const record = readStaggerRecordByStorageKey(
    getStaggerRecordStorageKey(offerId),
  );
  if (!record) return;

  const pending = record.pending.filter(
    (recipient) => !contactIds.includes(recipient.contactId),
  );
  if (pending.length === 0) {
    forgetLinkyBankPaymentOfferStaggerQueue(offerId);
    return;
  }
  rememberLinkyBankPaymentOfferStaggerQueue({ ...record, pending });
};

export const isLinkyBankPaymentOfferTerminalStatus = (
  status: LinkyBankPaymentOfferStatus,
): boolean =>
  status === "accepted_by_other" ||
  status === "canceled" ||
  status === "declined" ||
  status === "settled";

// Unlike `declined`, which only ends one recipient's thread, these statuses
// end the offer for every recipient.
export const isLinkyBankPaymentOfferWholeOfferTerminalStatus = (
  status: LinkyBankPaymentOfferStatus,
): boolean => status === "canceled" || status === "settled";

export const getLinkyBankPaymentOfferStatusRank = (
  status: LinkyBankPaymentOfferStatus,
): number => {
  switch (status) {
    case "offered":
      return 0;
    case "accepted":
      return 1;
    case "bank_details_sent":
      return 2;
    case "bank_paid":
      return 3;
    case "declined":
      return 4;
    case "accepted_by_other":
      return 5;
    case "canceled":
      return 6;
    case "settled":
      return 7;
  }
};

const getOfferText = (
  amountText: string,
  status: LinkyBankPaymentOfferStatus,
): string => {
  switch (status) {
    case "accepted":
      return "Nabídka byla přijata. Platební údaje se odesílají.";
    case "accepted_by_other":
      return "Někdo jiný přijal nabídku rychleji. Pro tebe tedy končí.";
    case "bank_details_sent":
      return `Platební údaje jsou připravené. Zaplať ${amountText} do 5 minut.`;
    case "bank_paid":
      return `Bankovní platba za ${amountText} byla označena jako zaplacená. Zkontroluj ji a odešli saty.`;
    case "canceled":
      return "Nabídka byla zrušena. Bankovní platbu už neposílej.";
    case "declined":
      return `Nabídka platby za ${amountText} byla odmítnuta`;
    case "offered":
      return `Zaplatíš za mě bankovní platbu ve výši ${amountText}?`;
    case "settled":
      return `Platba za ${amountText} byla dokončena`;
  }
};

export const getLinkyBankPaymentOfferMessageText = (
  amountText: string,
  status: LinkyBankPaymentOfferStatus,
  extensionSec?: number | null,
): string => {
  if (
    typeof extensionSec === "number" &&
    Number.isFinite(extensionSec) &&
    extensionSec > 0
  ) {
    return `Potřebuji víc času (+${Math.trunc(extensionSec)} s).`;
  }
  return getOfferText(amountText, status);
};

// Only the identifying fields are strict; every timestamp and optional text
// degrades to null so an offer from a newer or older build still renders.
const LinkyBankPaymentOfferMessage = Schema.Struct({
  amountSat: Schema.optional(Schema.Unknown),
  amountText: NonBlankString,
  bankPaidAtSec: Schema.optional(Schema.Unknown),
  expiresAtSec: Schema.optional(Schema.Unknown),
  extensionSec: Schema.optional(Schema.Unknown),
  initiatedAtSec: Schema.optional(Schema.Unknown),
  offerId: NonBlankString,
  offererPublicKey: Schema.optional(Schema.Unknown),
  spdPayload: Schema.optional(Schema.Unknown),
  status: LinkyBankPaymentOfferStatus,
  statusUpdatedAtSec: Schema.optional(Schema.Unknown),
  text: Schema.optional(Schema.Unknown),
  type: Schema.Literal("linky.bank_payment_offer"),
});
const decodeLinkyBankPaymentOfferMessage = Schema.decodeUnknownOption(
  LinkyBankPaymentOfferMessage,
);

const isPositiveFiniteNumber = Schema.is(PositiveFiniteNumber);

const readPositiveSeconds = (value: unknown): number | null =>
  isPositiveFiniteNumber(value) ? Math.trunc(value) : null;

export const getLinkyBankPaymentOfferInfo = (
  content: string,
): LinkyBankPaymentOfferInfo | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const message = Option.getOrNull(decodeLinkyBankPaymentOfferMessage(parsed));
  if (!message) return null;

  const amountText = message.amountText.trim();
  return {
    amountSat: isPositiveFiniteNumber(message.amountSat)
      ? Math.round(message.amountSat)
      : null,
    amountText,
    bankPaidAtSec: readPositiveSeconds(message.bankPaidAtSec),
    expiresAtSec: readPositiveSeconds(message.expiresAtSec),
    extensionSec: readPositiveSeconds(message.extensionSec),
    initiatedAtSec: readPositiveSeconds(message.initiatedAtSec),
    offerId: message.offerId.trim(),
    offererPublicKey: asNonEmptyString(message.offererPublicKey),
    spdPayload: asNonEmptyString(message.spdPayload),
    status: message.status,
    statusUpdatedAtSec: readPositiveSeconds(message.statusUpdatedAtSec),
    text:
      asNonEmptyString(message.text) ??
      getOfferText(amountText, message.status),
  };
};

interface BankPaymentOfferContactEntry {
  info: LinkyBankPaymentOfferInfo;
  message: LocalNostrMessage;
}

interface ActiveBankPaymentOfferContacts {
  contactIds: ReadonlySet<string>;
  nextExpiryAtSec: number | null;
}

const getBankPaymentOfferEntryTime = (
  entry: BankPaymentOfferContactEntry,
): number => entry.info.statusUpdatedAtSec || entry.message.createdAtSec || 0;

const isNewerBankPaymentOfferEntry = (
  candidate: BankPaymentOfferContactEntry,
  current: BankPaymentOfferContactEntry,
): boolean => {
  const rankDelta =
    getLinkyBankPaymentOfferStatusRank(candidate.info.status) -
    getLinkyBankPaymentOfferStatusRank(current.info.status);
  return (
    rankDelta > 0 ||
    (rankDelta === 0 &&
      getBankPaymentOfferEntryTime(candidate) >
        getBankPaymentOfferEntryTime(current))
  );
};

export const getActiveBankPaymentOfferContacts = (
  messages: readonly LocalNostrMessage[],
  nowSec: number,
): ActiveBankPaymentOfferContacts => {
  const groups = new Map<string, Map<string, BankPaymentOfferContactEntry>>();

  for (const message of messages) {
    const info = getLinkyBankPaymentOfferInfo(message.content);
    const contactId = message.contactId.trim();
    if (!info || !contactId) continue;

    const entriesByContact =
      groups.get(info.offerId) ??
      new Map<string, BankPaymentOfferContactEntry>();
    const entry = { info, message };
    const current = entriesByContact.get(contactId);
    if (!current || isNewerBankPaymentOfferEntry(entry, current)) {
      entriesByContact.set(contactId, entry);
    }
    groups.set(info.offerId, entriesByContact);
  }

  const contactIds = new Set<string>();
  let nextExpiryAtSec: number | null = null;

  for (const entriesByContact of groups.values()) {
    const entries = [...entriesByContact.values()];
    if (
      entries.some(({ info }) =>
        isLinkyBankPaymentOfferWholeOfferTerminalStatus(info.status),
      )
    ) {
      continue;
    }

    for (const { info, message } of entries) {
      if (isLinkyBankPaymentOfferTerminalStatus(info.status)) continue;

      const expiresAtSec = getLinkyBankPaymentOfferExpiresAtSec(
        info,
        message.createdAtSec,
      );
      if (expiresAtSec !== null) {
        if (nowSec >= expiresAtSec) continue;
        nextExpiryAtSec =
          nextExpiryAtSec === null
            ? expiresAtSec
            : Math.min(nextExpiryAtSec, expiresAtSec);
      }

      contactIds.add(message.contactId.trim());
    }
  }

  return { contactIds, nextExpiryAtSec };
};

const getLinkyBankPaymentOfferBankPaidAtSec = (
  info: LinkyBankPaymentOfferInfo,
): number | null =>
  info.bankPaidAtSec ??
  (info.status === "bank_paid" ? info.statusUpdatedAtSec : null);

export const getLinkyBankPaymentOfferResponseDurationSec = (
  info: LinkyBankPaymentOfferInfo,
  createdAtSec: number,
): number | null => {
  const initiatedAtSec = info.initiatedAtSec ?? Math.trunc(createdAtSec);
  const bankPaidAtSec = getLinkyBankPaymentOfferBankPaidAtSec(info);
  if (
    !Number.isFinite(initiatedAtSec) ||
    initiatedAtSec <= 0 ||
    bankPaidAtSec === null ||
    bankPaidAtSec < initiatedAtSec
  ) {
    return null;
  }
  return bankPaidAtSec - initiatedAtSec;
};

type BankPaymentOfferResponseMessage = Pick<
  LocalNostrMessage,
  "contactId" | "content" | "createdAtSec" | "direction"
>;

export const getLastBankPaymentOfferResponseSecByContactId = (
  messages: readonly BankPaymentOfferResponseMessage[],
): ReadonlyMap<string, number> => {
  const latestByContactId = new Map<
    string,
    { bankPaidAtSec: number; durationSec: number }
  >();

  for (const message of messages) {
    if (message.direction !== "out") continue;
    const contactId = (message.contactId ?? "").trim();
    const content = message.content ?? "";
    const createdAtSec = message.createdAtSec;
    if (!contactId || !content || !Number.isFinite(createdAtSec)) continue;

    const info = getLinkyBankPaymentOfferInfo(content);
    if (!info) continue;
    const bankPaidAtSec = getLinkyBankPaymentOfferBankPaidAtSec(info);
    const durationSec = getLinkyBankPaymentOfferResponseDurationSec(
      info,
      createdAtSec,
    );
    if (bankPaidAtSec === null || durationSec === null) continue;

    const latest = latestByContactId.get(contactId);
    if (!latest || bankPaidAtSec > latest.bankPaidAtSec) {
      latestByContactId.set(contactId, { bankPaidAtSec, durationSec });
    }
  }

  return new Map(
    Array.from(latestByContactId, ([contactId, value]) => [
      contactId,
      value.durationSec,
    ]),
  );
};

export const mergeBankPaymentOffersIntoLastMessageByContactId = (
  lastMessageByContactId: ReadonlyMap<string, LocalNostrMessage>,
  bankPaymentOfferMessages: readonly LocalNostrMessage[],
): Map<string, LocalNostrMessage> => {
  const merged = new Map(lastMessageByContactId);

  for (const message of bankPaymentOfferMessages) {
    const contactId = message.contactId.trim();
    if (!contactId) continue;

    const current = merged.get(contactId);
    const currentCreatedAtSec = (current?.createdAtSec ?? 0) || 0;
    const messageCreatedAtSec = message.createdAtSec || 0;
    if (!current || messageCreatedAtSec >= currentCreatedAtSec) {
      merged.set(contactId, message);
    }
  }

  return merged;
};

export const formatRemainingTime = (
  remainingSec: number,
  t: Translate,
): string => {
  if (remainingSec <= 0) return t("bankPaymentOfferExpired");

  const minutes = Math.floor(remainingSec / 60);
  const seconds = Math.max(0, remainingSec % 60);
  return t("bankPaymentOfferTimeRemainingClock")
    .replace("{minutes}", String(minutes))
    .replace("{seconds}", String(seconds).padStart(2, "0"));
};

export const getBankPaymentOfferStatusLabel = (
  status: LinkyBankPaymentOfferStatus,
  isIncoming: boolean,
  t: Translate,
): string => {
  switch (status) {
    case "accepted":
      return t("bankPaymentOfferStatusAccepted");
    case "accepted_by_other":
      return t("bankPaymentOfferStatusAcceptedByOther");
    case "bank_details_sent":
      return isIncoming
        ? t("bankPaymentOfferStatusBankDetailsReceived")
        : t("bankPaymentOfferStatusBankDetailsSent");
    case "bank_paid":
      return t("bankPaymentOfferStatusBankPaid");
    case "canceled":
      return t("bankPaymentOfferStatusCanceled");
    case "declined":
      return t("bankPaymentOfferStatusDeclined");
    case "settled":
      return t("bankPaymentOfferStatusSettled");
    case "offered":
      return t("bankPaymentOfferStatusOffered");
  }
};

export const hasBankPaymentOfferTimedPhase = (
  status: LinkyBankPaymentOfferStatus,
): boolean =>
  status === "accepted" ||
  status === "bank_details_sent" ||
  status === "bank_paid" ||
  status === "offered";
