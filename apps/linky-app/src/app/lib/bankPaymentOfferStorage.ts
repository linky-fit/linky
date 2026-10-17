import { BankOfferId, Pubkey } from "@linky-fit/linkstr";
import {
  BankPaymentOfferStaggerRecord,
  isBankPaymentOfferStaggerRecordExpired,
} from "@linky-fit/proxy-payment";
import { Option, Schema } from "effect";
import { NonBlankString, PositiveFiniteNumber } from "../../utils/schema";
import {
  canLockAcrossTabs,
  safeLocalStorageGet,
  safeLocalStorageGetJson,
  safeLocalStorageKeys,
  safeLocalStorageRemove,
  safeLocalStorageSetJson,
  safeSessionStorageGet,
  safeSessionStorageRemove,
  safeSessionStorageSet,
} from "../../utils/storage";
import { nowSeconds } from "../../utils/time";
import {
  type StoredSpdRecord,
  updateSpdRecords,
} from "../../platform/bankPaymentOfferSpdStore";

const isBankOfferId = Schema.is(BankOfferId);
const isPubkey = Schema.is(Pubkey);

const MINIMIZED_KEY_PREFIX = "linky.bank_payment_offer_minimized.v1";
const LEGACY_SPD_KEY_PREFIX = "linky.bank_payment_offer_spd.v1";
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

/**
 * The bank QR of an offer this device created, kept until the auto-responder
 * has handed it to the winning payer, and the payer it is pinned to.
 */
const BankPaymentOfferSpdRecord = Schema.Struct({
  offerId: BankOfferId,
  createdAtSec: PositiveFiniteNumber,
  ownerPubkey: Schema.String,
  pin: Schema.optional(
    Schema.Struct({ delivered: Schema.Boolean, peer: Pubkey }),
  ),
  singleTabRiskAccepted: Schema.optional(Schema.Literal(true)),
  spdPayload: NonBlankString,
});
type BankPaymentOfferSpdRecord = typeof BankPaymentOfferSpdRecord.Type;
const decodeSpdRecord = Schema.decodeUnknownOption(BankPaymentOfferSpdRecord);

/** What the release before IndexedDB kept in localStorage, one key per offer. */
const LegacySpdRecord = Schema.fromJsonString(
  Schema.Struct({
    createdAtSec: PositiveFiniteNumber,
    ownerPubkey: Schema.String,
    sentCandidateKeys: Schema.Array(Schema.String),
    detailsSent: Schema.optional(Schema.Boolean),
    singleTabRiskAccepted: Schema.optional(Schema.Literal(true)),
    spdPayload: NonBlankString,
  }),
);
const decodeLegacySpdRecord = Schema.decodeUnknownOption(LegacySpdRecord);

// A future createdAtSec (backward clock jump) also counts as expired so a
// record can never outlive the intended one-hour window.
const isLiveSpdRecord = (
  record: BankPaymentOfferSpdRecord,
  nowSec: number,
): boolean =>
  record.createdAtSec <= nowSec &&
  nowSec - record.createdAtSec < SPD_MAX_AGE_SEC;

const findSpdRecord = (
  stored: readonly StoredSpdRecord[],
  offerId: BankOfferId,
): BankPaymentOfferSpdRecord | null =>
  Option.getOrNull(
    decodeSpdRecord(stored.find((entry) => entry.offerId === offerId)?.value),
  );

const fromLegacySpdRecord = (key: string): BankPaymentOfferSpdRecord | null => {
  const offerId = decodeURIComponent(
    key.slice(LEGACY_SPD_KEY_PREFIX.length + 1),
  );
  const legacy = Option.getOrNull(
    decodeLegacySpdRecord(safeLocalStorageGet(key)),
  );
  if (!legacy || !isBankOfferId(offerId)) return null;
  const { detailsSent, sentCandidateKeys, ...fields } = legacy;
  const [candidateKey] = sentCandidateKeys;
  if (candidateKey === undefined) return { ...fields, offerId };
  const peer = candidateKey.slice(offerId.length + 1);
  // A pin that does not name a payer cannot be honored, so the record goes.
  return isPubkey(peer)
    ? { ...fields, offerId, pin: { delivered: detailsSent !== false, peer } }
    : null;
};

const legacySpdRecords = () =>
  safeLocalStorageKeys()
    .filter((key) => key.startsWith(`${LEGACY_SPD_KEY_PREFIX}.`))
    .map((key) => ({ key, record: fromLegacySpdRecord(key) }));

/**
 * This device's live records of `ownerPubkey`. Deletes expired ones, so a
 * later clock correction cannot bring them back, and takes over the records
 * the previous release kept in localStorage.
 */
const readSpdRecords = async (
  ownerPubkey: string,
): Promise<BankPaymentOfferSpdRecord[]> => {
  const legacy = legacySpdRecords();
  const nowSec = nowSeconds();
  const records = await updateSpdRecords((stored) => {
    const live: BankPaymentOfferSpdRecord[] = [];
    const expired: string[] = [];
    const legacyRecords = legacy.flatMap(({ record }) =>
      record ? [record] : [],
    );
    const legacyIds = new Set<string>(
      legacyRecords.map((record) => record.offerId),
    );
    for (const entry of stored) {
      if (legacyIds.has(entry.offerId)) continue;
      const record = Option.getOrNull(decodeSpdRecord(entry.value));
      if (record && isLiveSpdRecord(record, nowSec)) live.push(record);
      else expired.push(entry.offerId);
    }
    for (const record of legacyRecords) {
      if (isLiveSpdRecord(record, nowSec)) live.push(record);
      else expired.push(record.offerId);
    }
    return {
      put: legacyRecords.filter((record) => !expired.includes(record.offerId)),
      remove: expired,
      result: live,
    };
  });
  for (const { key } of legacy) safeLocalStorageRemove(key);
  return records.filter((record) => record.ownerPubkey === ownerPubkey);
};

export const rememberBankPaymentOfferSpdPayload = async (args: {
  offerId: BankOfferId;
  ownerPubkey: string;
  singleTabRiskAccepted?: boolean;
  spdPayload: string;
}): Promise<void> => {
  const spdPayload = args.spdPayload.trim();
  if (!spdPayload) return;
  const record: BankPaymentOfferSpdRecord = {
    offerId: args.offerId,
    createdAtSec: nowSeconds(),
    ownerPubkey: args.ownerPubkey,
    ...(args.singleTabRiskAccepted ? { singleTabRiskAccepted: true } : {}),
    spdPayload,
  };
  await updateSpdRecords(() => ({ put: [record], remove: [], result: null }));
};

export const readBankPaymentOfferSpdRecord = async (args: {
  offerId: BankOfferId;
  ownerPubkey: string;
}): Promise<BankPaymentOfferSpdRecord | null> =>
  (await readSpdRecords(args.ownerPubkey)).find(
    (record) => record.offerId === args.offerId,
  ) ?? null;

/** The offers this device created for one bank QR and still keeps the QR of. */
export const readBankPaymentOfferIdsForSpdPayload = async (args: {
  ownerPubkey: string;
  spdPayload: string;
}): Promise<BankOfferId[]> =>
  (await readSpdRecords(args.ownerPubkey)).flatMap((record) =>
    record.spdPayload === args.spdPayload ? [record.offerId] : [],
  );

/**
 * Pins the payer who gets an offer's bank details and resolves true once the
 * pin names `peer` and is committed, so nothing is sent before it would
 * survive a crash. A pin is never replaced.
 */
export const reserveBankPaymentOfferBankDetails = async (args: {
  offerId: BankOfferId;
  ownerPubkey: string;
  peer: Pubkey;
}): Promise<boolean> => {
  const reserve = () =>
    updateSpdRecords((stored) => {
      const record = findSpdRecord(stored, args.offerId);
      if (
        !record ||
        record.ownerPubkey !== args.ownerPubkey ||
        !isLiveSpdRecord(record, nowSeconds())
      )
        return { put: [], remove: [], result: false };
      if (record.pin) {
        return { put: [], remove: [], result: record.pin.peer === args.peer };
      }
      return {
        put: [{ ...record, pin: { delivered: false, peer: args.peer } }],
        remove: [],
        result: true,
      };
    });
  if (canLockAcrossTabs()) {
    return navigator.locks.request(
      `${BANK_PAYMENT_OFFER_DETAILS_LOCK_KEY_PREFIX}.recipient.${args.offerId}`,
      reserve,
    );
  }
  return (
    (await readBankPaymentOfferSpdRecord(args))?.singleTabRiskAccepted ===
      true && reserve()
  );
};

/** Records that a relay accepted the pinned payer's copy of the bank details. */
export const markBankPaymentOfferBankDetailsDelivered = (args: {
  offerId: BankOfferId;
  peer: Pubkey;
}): Promise<void> =>
  updateSpdRecords((stored) => {
    const record = findSpdRecord(stored, args.offerId);
    return {
      put:
        record?.pin?.peer === args.peer
          ? [{ ...record, pin: { delivered: true, peer: args.peer } }]
          : [],
      remove: [],
      result: undefined,
    };
  });

export const forgetBankPaymentOfferSpdPayloads = async (
  offerIds: readonly BankOfferId[],
): Promise<void> => {
  if (offerIds.length === 0) return;
  await updateSpdRecords(() => ({ put: [], remove: offerIds, result: null }));
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
