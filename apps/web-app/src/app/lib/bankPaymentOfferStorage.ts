import { BankOfferId, type Pubkey } from "@linky-fit/linkstr";
import {
  BankPaymentOfferStaggerRecord,
  isBankPaymentOfferStaggerRecordExpired,
} from "@linky-fit/proxy-payment";
import { Schema } from "effect";
import { NonBlankString, PositiveFiniteNumber } from "../../utils/schema";
import {
  canLockAcrossTabs,
  safeLocalStorageGetJson,
  safeLocalStorageKeys,
  safeLocalStorageRemove,
  safeLocalStorageSetJson,
  safeSessionStorageGet,
  safeSessionStorageRemove,
  safeSessionStorageSet,
} from "../../utils/storage";
import { nowSeconds } from "../../utils/time";

const isBankOfferId = Schema.is(BankOfferId);

const MINIMIZED_KEY_PREFIX = "linky.bank_payment_offer_minimized.v1";
const SPD_KEY_PREFIX = "linky.bank_payment_offer_spd.v1";
const SPD_MAX_AGE_SEC = 60 * 60;
const STAGGER_KEY_PREFIX = "linky.bank_payment_offer_stagger.v1";
export const BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX =
  "linky.bank_payment_offer_details_lock.v1";
export const BANK_PAYMENT_OFFER_STAGGER_LOCK_KEY_PREFIX =
  "linky.bank_payment_offer_stagger_lock.v1";

const minimizedKey = (chatId: string, offerId: string): string =>
  `${MINIMIZED_KEY_PREFIX}.${encodeURIComponent(chatId)}.${encodeURIComponent(offerId)}`;

export const isBankPaymentOfferMinimized = (
  chatId: string,
  offerId: string,
): boolean => safeSessionStorageGet(minimizedKey(chatId, offerId)) === "1";

export const setBankPaymentOfferMinimized = (
  chatId: string,
  offerId: string,
  minimized: boolean,
): void => {
  const key = minimizedKey(chatId, offerId);
  if (minimized) safeSessionStorageSet(key, "1");
  else safeSessionStorageRemove(key);
};

/** The bank QR of an offer this device created, kept until the auto-responder
 * has handed it to the winning recipient. */
const BankPaymentOfferSpdRecord = Schema.Struct({
  createdAtSec: PositiveFiniteNumber,
  ownerPubkey: Schema.String,
  sentCandidateKeys: Schema.Array(Schema.String),
  detailsSent: Schema.optional(Schema.Boolean),
  singleTabRiskAccepted: Schema.optional(Schema.Literal(true)),
  spdPayload: NonBlankString,
});
type BankPaymentOfferSpdRecord = typeof BankPaymentOfferSpdRecord.Type;

// One storage key per offer so concurrent tabs working on different offers
// never overwrite each other's records.
const spdKey = (offerId: string): string =>
  `${SPD_KEY_PREFIX}.${encodeURIComponent(offerId)}`;

// A future createdAtSec (backward clock jump) also counts as expired so a
// record can never outlive the intended one-hour window.
const isExpiredSpdRecord = (
  record: BankPaymentOfferSpdRecord,
  nowSec: number,
): boolean =>
  record.createdAtSec > nowSec ||
  nowSec - record.createdAtSec >= SPD_MAX_AGE_SEC;

const readSpdRecordByKey = (key: string): BankPaymentOfferSpdRecord | null =>
  safeLocalStorageGetJson(key, Schema.NullOr(BankPaymentOfferSpdRecord), null);

const writeSpdRecord = (
  offerId: string,
  record: BankPaymentOfferSpdRecord,
): void => {
  safeLocalStorageSetJson(spdKey(offerId), record);
};

const pruneExpiredSpdRecords = (nowSec: number): void => {
  for (const key of safeLocalStorageKeys()) {
    if (!key.startsWith(`${SPD_KEY_PREFIX}.`)) continue;
    const record = readSpdRecordByKey(key);
    if (!record || isExpiredSpdRecord(record, nowSec)) {
      safeLocalStorageRemove(key);
    }
  }
};

export const rememberBankPaymentOfferSpdPayload = (args: {
  offerId: string;
  ownerPubkey: string;
  singleTabRiskAccepted?: boolean;
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
    ...(args.singleTabRiskAccepted ? { singleTabRiskAccepted: true } : {}),
    spdPayload,
  });
};

export const readBankPaymentOfferSpdRecord = (args: {
  offerId: string;
  ownerPubkey: string;
}): BankPaymentOfferSpdRecord | null => {
  const record = readSpdRecordByKey(spdKey(args.offerId));
  if (!record) return null;
  // Delete rather than just hide an expired record so a later clock
  // correction cannot bring it back to life.
  if (isExpiredSpdRecord(record, nowSeconds())) {
    forgetBankPaymentOfferSpdPayload(args.offerId);
    return null;
  }
  return record.ownerPubkey === args.ownerPubkey ? record : null;
};

/** The offers this device created for one bank QR and still keeps the QR of. */
export const readBankPaymentOfferIdsForSpdPayload = (args: {
  ownerPubkey: string;
  spdPayload: string;
}): BankOfferId[] =>
  safeLocalStorageKeys().flatMap((key) => {
    if (!key.startsWith(`${SPD_KEY_PREFIX}.`)) return [];
    const offerId = decodeURIComponent(key.slice(SPD_KEY_PREFIX.length + 1));
    return isBankOfferId(offerId) &&
      readBankPaymentOfferSpdRecord({ ...args, offerId })?.spdPayload ===
        args.spdPayload
      ? [offerId]
      : [];
  });

export const reserveBankPaymentOfferBankDetails = async (args: {
  candidateKey: string;
  offerId: string;
  ownerPubkey: string;
}): Promise<boolean> => {
  const reserve = (): boolean => {
    const record = readBankPaymentOfferSpdRecord(args);
    if (!record) return false;
    if (record.sentCandidateKeys.length > 0) {
      return (
        record.sentCandidateKeys.length === 1 &&
        record.sentCandidateKeys[0] === args.candidateKey
      );
    }
    writeSpdRecord(args.offerId, {
      ...record,
      sentCandidateKeys: [args.candidateKey],
      detailsSent: false,
    });
    const saved = readBankPaymentOfferSpdRecord(args);
    return (
      saved?.sentCandidateKeys.length === 1 &&
      saved.sentCandidateKeys[0] === args.candidateKey
    );
  };
  if (canLockAcrossTabs()) {
    return navigator.locks.request(
      `${BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX}.recipient.${args.offerId}`,
      reserve,
    );
  }
  return (
    readBankPaymentOfferSpdRecord(args)?.singleTabRiskAccepted === true &&
    reserve()
  );
};

export const markBankPaymentOfferBankDetailsSent = (args: {
  candidateKey: string;
  offerId: string;
}): void => {
  const record = readSpdRecordByKey(spdKey(args.offerId));
  if (
    !record ||
    (record.sentCandidateKeys.length > 0 &&
      (record.sentCandidateKeys.length !== 1 ||
        record.sentCandidateKeys[0] !== args.candidateKey))
  )
    return;
  writeSpdRecord(args.offerId, {
    ...record,
    sentCandidateKeys: [args.candidateKey],
    detailsSent: true,
  });
};

export const forgetBankPaymentOfferSpdPayload = (offerId: string): void => {
  safeLocalStorageRemove(spdKey(offerId));
};

const staggerKey = (offerId: BankOfferId): string =>
  `${STAGGER_KEY_PREFIX}.${encodeURIComponent(offerId)}`;

const readStaggerRecordByKey = (
  key: string,
): BankPaymentOfferStaggerRecord | null =>
  safeLocalStorageGetJson(
    key,
    Schema.NullOr(BankPaymentOfferStaggerRecord),
    null,
  );

export const forgetBankPaymentOfferStaggerQueue = (
  offerId: BankOfferId,
): void => {
  safeLocalStorageRemove(staggerKey(offerId));
};

export const rememberBankPaymentOfferStaggerQueue = (
  record: BankPaymentOfferStaggerRecord,
): void => {
  if (record.pending.length === 0) return;
  safeLocalStorageSetJson(staggerKey(record.offerId), record);
};

export const readBankPaymentOfferStaggerRecords = (
  ownerPubkey: Pubkey,
): BankPaymentOfferStaggerRecord[] => {
  const records: BankPaymentOfferStaggerRecord[] = [];
  const nowSec = nowSeconds();
  for (const key of safeLocalStorageKeys()) {
    if (!key.startsWith(`${STAGGER_KEY_PREFIX}.`)) continue;
    const record = readStaggerRecordByKey(key);
    if (!record || isBankPaymentOfferStaggerRecordExpired(record, nowSec)) {
      safeLocalStorageRemove(key);
      continue;
    }
    if (record.ownerPubkey === ownerPubkey) records.push(record);
  }
  return records;
};

export const removeBankPaymentOfferStaggerRecipients = (
  offerId: BankOfferId,
  peers: readonly Pubkey[],
): void => {
  const record = readStaggerRecordByKey(staggerKey(offerId));
  if (!record) return;

  const pending = record.pending.filter(
    (recipient) => !peers.includes(recipient.peer),
  );
  if (pending.length === 0) {
    forgetBankPaymentOfferStaggerQueue(offerId);
    return;
  }
  rememberBankPaymentOfferStaggerQueue({ ...record, pending });
};
