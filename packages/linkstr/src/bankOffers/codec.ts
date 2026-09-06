import { Either, Option, Schema } from "effect";
import {
  ClientId,
  isClientId,
  isPubkey,
  isRumorId,
  isUnixSeconds,
  Pubkey,
  UnixSeconds,
} from "../domain/primitives";
import type { DropReason } from "../inbox/events";
import {
  firstTrimmedTagValue,
  Rumor,
  rumorWithHash,
  tagValues,
} from "../internal/nostrEvent";
import type { NostrTags } from "../internal/nostrEvent";
import { BankOfferId, BankOfferStatus } from "./domain";
import type { BankOfferDraft } from "./domain";
import {
  BankOfferSnapshotReceived,
  OwnBankOfferSnapshotConfirmed,
} from "./events";
import type { BankOfferInboxEvent } from "./events";

export const BANK_OFFER_KIND = 24135;
export const BANK_OFFER_VALUE = "bank_payment_offer";

const isBankOfferId = Schema.is(BankOfferId);
const isBankOfferStatus = Schema.is(BankOfferStatus);
const isNonEmptyTrimmedString = Schema.is(Schema.NonEmptyTrimmedString);
const isPositiveInt = Schema.is(Schema.Int.pipe(Schema.positive()));
const decodeJsonRecord = Schema.decodeUnknownOption(
  Schema.parseJson(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
);

/** The offer-message payload; `null` fields are omitted from the JSON. `text`
 * is the display copy, which the app owns and templates. */
export interface BankOfferContent {
  offerId: BankOfferId;
  offerer: Pubkey;
  status: BankOfferStatus;
  amountText: string;
  text: string;
  statusUpdatedAtSec: UnixSeconds | null;
  initiatedAtSec: UnixSeconds | null;
  bankPaidAtSec: UnixSeconds | null;
  expiresAtSec: UnixSeconds | null;
  extensionSec: number | null;
  amountSat: number | null;
  spdPayload: string | null;
}

/** The single definition of the offer-message wire shape; key order is part of
 * the format, so keep the literal in this order. */
export const encodeBankOfferContent = (content: BankOfferContent): string =>
  JSON.stringify({
    amountText: content.amountText,
    offerId: content.offerId,
    offererPublicKey: content.offerer,
    status: content.status,
    ...(content.statusUpdatedAtSec === null
      ? {}
      : { statusUpdatedAtSec: content.statusUpdatedAtSec }),
    text: content.text,
    type: "linky.bank_payment_offer",
    version: 1,
    ...(content.initiatedAtSec === null
      ? {}
      : { initiatedAtSec: content.initiatedAtSec }),
    ...(content.bankPaidAtSec === null
      ? {}
      : { bankPaidAtSec: content.bankPaidAtSec }),
    ...(content.expiresAtSec === null
      ? {}
      : { expiresAtSec: content.expiresAtSec }),
    ...(content.extensionSec === null
      ? {}
      : { extensionSec: content.extensionSec }),
    ...(content.amountSat === null ? {} : { amountSat: content.amountSat }),
    ...(content.spdPayload === null ? {} : { spdPayload: content.spdPayload }),
  });

export const encodeBankOfferRumor = (
  draft: BankOfferDraft,
  author: Pubkey,
  sentAt: UnixSeconds,
  clientId: ClientId,
): Rumor => {
  const content = encodeBankOfferContent({
    offerId: draft.offerId,
    offerer: draft.offerer,
    status: draft.status,
    amountText: draft.amountText,
    text: draft.text,
    statusUpdatedAtSec: sentAt,
    initiatedAtSec:
      draft.initiatedAtSec ?? (draft.status === "offered" ? sentAt : null),
    bankPaidAtSec:
      draft.bankPaidAtSec ?? (draft.status === "bank_paid" ? sentAt : null),
    expiresAtSec: draft.expiresAtSec ?? null,
    extensionSec: draft.extensionSec ?? null,
    amountSat: draft.amountSat ?? null,
    spdPayload: draft.spdPayload ?? null,
  });

  return rumorWithHash({
    pubkey: author,
    created_at: sentAt,
    kind: BANK_OFFER_KIND,
    tags: [
      ["p", draft.to],
      ["p", author],
      ["client", clientId],
      ["offer", draft.offerId],
      ["offerer", draft.offerer],
      ["linky", BANK_OFFER_VALUE],
      ["status", draft.status],
    ],
    content,
  });
};

const trimmedString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isNonEmptyTrimmedString(trimmed) ? trimmed : null;
};

const positiveInt = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const integer = Math.trunc(value);
  return isPositiveInt(integer) ? integer : null;
};

const unixSeconds = (value: unknown): UnixSeconds | null => {
  const integer = positiveInt(value);
  return integer !== null && isUnixSeconds(integer) ? integer : null;
};

const clientIdOf = (tags: NostrTags): ClientId | null => {
  const value = firstTrimmedTagValue(tags, "client");
  return value !== null && isClientId(value) ? value : null;
};

const decodeContent = (content: string) =>
  Option.flatMap(decodeJsonRecord(content), (record) => {
    const offerIdText = trimmedString(record.offerId);
    const amountText = trimmedString(record.amountText);
    const offererText = trimmedString(record.offererPublicKey);
    if (
      record.type !== "linky.bank_payment_offer" ||
      offerIdText === null ||
      !isBankOfferId(offerIdText) ||
      amountText === null ||
      !isBankOfferStatus(record.status)
    ) {
      return Option.none();
    }
    return Option.some({
      record,
      offerId: offerIdText,
      amountText,
      status: record.status,
      offererText,
    });
  });

export const decodeBankOfferRumor = (
  rumor: Rumor,
  me: Pubkey,
): Either.Either<BankOfferInboxEvent, DropReason> => {
  const snapshotId = rumor.id;
  if (
    rumor.kind !== BANK_OFFER_KIND ||
    !rumor.tags.some(
      (tag) => tag[0] === "linky" && tag[1] === BANK_OFFER_VALUE,
    ) ||
    !tagValues(rumor.tags, "p").includes(me) ||
    !isRumorId(snapshotId)
  ) {
    return Either.left("invalid-bank-offer");
  }

  return Option.match(decodeContent(rumor.content), {
    onNone: () => Either.left<DropReason>("invalid-bank-offer"),
    onSome: ({ amountText, offerId, offererText, record, status }) => {
      const offerer =
        offererText ?? firstTrimmedTagValue(rumor.tags, "offerer");
      if (offerer === null || !isPubkey(offerer)) {
        return Either.left<DropReason>("invalid-bank-offer");
      }
      const snapshot = {
        snapshotId,
        offerId,
        offerer,
        status,
        amountText,
        text: trimmedString(record.text),
        amountSat: positiveInt(record.amountSat),
        initiatedAtSec: unixSeconds(record.initiatedAtSec),
        bankPaidAtSec: unixSeconds(record.bankPaidAtSec),
        expiresAtSec: unixSeconds(record.expiresAtSec),
        extensionSec: positiveInt(record.extensionSec),
        spdPayload: trimmedString(record.spdPayload),
        statusUpdatedAtSec: unixSeconds(record.statusUpdatedAtSec),
        clientId: clientIdOf(rumor.tags),
        sentAt: rumor.created_at,
      };
      if (rumor.pubkey !== me) {
        return Either.right(
          new BankOfferSnapshotReceived({ from: rumor.pubkey, ...snapshot }),
        );
      }
      const to =
        tagValues(rumor.tags, "p")
          .filter((value) => value !== rumor.pubkey)
          .find(isPubkey) ?? null;
      if (to === null) return Either.left<DropReason>("invalid-bank-offer");
      return Either.right(
        new OwnBankOfferSnapshotConfirmed({ to, ...snapshot }),
      );
    },
  });
};
