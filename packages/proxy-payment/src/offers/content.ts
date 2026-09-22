import {
  BankOfferId,
  BankOfferStatus,
  encodeBankOfferContent,
  isUnixSeconds,
  Pubkey,
} from "@linky/linkstr";
import { Option, Schema } from "effect";
import {
  asNonEmptyString,
  isPositiveFiniteNumber,
  NonBlankString,
} from "../internal/schema";

/** One decoded offer snapshot; the content JSON of an offer message. */
export interface BankPaymentOfferInfo {
  amountSat: number | null;
  amountText: string;
  bankPaidAtSec: number | null;
  expiresAtSec: number | null;
  extensionSec: number | null;
  initiatedAtSec: number | null;
  offerId: BankOfferId;
  offererPublicKey: Pubkey | null;
  spdPayload: string | null;
  status: BankOfferStatus;
  statusUpdatedAtSec: number | null;
  text: string;
}

// The copy travels on the wire so clients that only show `text` can render a
// snapshot; it is fixed Czech by protocol, not the sender's locale.
const offerText = (amountText: string, status: BankOfferStatus): string => {
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

export const bankPaymentOfferMessageText = (
  amountText: string,
  status: BankOfferStatus,
  extensionSec?: number | null,
): string =>
  typeof extensionSec === "number" &&
  Number.isFinite(extensionSec) &&
  extensionSec > 0
    ? `Potřebuji víc času (+${Math.trunc(extensionSec)} s).`
    : offerText(amountText, status);

// Only the identifying fields are strict; every timestamp and optional text
// degrades to null so an offer from a newer or older build still renders.
const OfferContent = Schema.Struct({
  amountSat: Schema.optional(Schema.Unknown),
  amountText: NonBlankString,
  bankPaidAtSec: Schema.optional(Schema.Unknown),
  expiresAtSec: Schema.optional(Schema.Unknown),
  extensionSec: Schema.optional(Schema.Unknown),
  initiatedAtSec: Schema.optional(Schema.Unknown),
  offerId: BankOfferId,
  offererPublicKey: Schema.optional(Schema.Unknown),
  spdPayload: Schema.optional(Schema.Unknown),
  status: BankOfferStatus,
  statusUpdatedAtSec: Schema.optional(Schema.Unknown),
  text: Schema.optional(Schema.Unknown),
  type: Schema.Literal("linky.bank_payment_offer"),
});
const decodeOfferContent = Schema.decodeUnknownOption(
  Schema.parseJson(OfferContent),
);

const readPositiveSeconds = (value: unknown): number | null =>
  isPositiveFiniteNumber(value) ? Math.trunc(value) : null;

const readPubkey = (value: unknown): Pubkey | null =>
  Option.getOrNull(Schema.decodeUnknownOption(Pubkey)(value));

export const decodeBankPaymentOffer = (
  content: string,
): BankPaymentOfferInfo | null => {
  const message = Option.getOrNull(decodeOfferContent(content));
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
    offerId: message.offerId,
    offererPublicKey: readPubkey(message.offererPublicKey),
    spdPayload: asNonEmptyString(message.spdPayload),
    status: message.status,
    statusUpdatedAtSec: readPositiveSeconds(message.statusUpdatedAtSec),
    text:
      asNonEmptyString(message.text) ?? offerText(amountText, message.status),
  };
};

interface SnapshotFields {
  amountSat: number | null;
  amountText: string;
  bankPaidAtSec: number | null;
  expiresAtSec: number | null;
  extensionSec: number | null;
  initiatedAtSec: number | null;
  offerId: BankOfferId;
  offerer: Pubkey;
  spdPayload: string | null;
  status: BankOfferStatus;
  statusUpdatedAtSec: number | null;
  text: string | null;
}

const unixSecondsOrNull = (value: number | null) =>
  value !== null && isUnixSeconds(value) ? value : null;

/** Re-encodes an inbox snapshot into offer message content. */
export const bankOfferContentFromSnapshot = (
  snapshot: SnapshotFields,
): string =>
  encodeBankOfferContent({
    offerId: snapshot.offerId,
    offerer: snapshot.offerer,
    status: snapshot.status,
    amountText: snapshot.amountText,
    text:
      snapshot.text ??
      bankPaymentOfferMessageText(
        snapshot.amountText,
        snapshot.status,
        snapshot.extensionSec,
      ),
    statusUpdatedAtSec: unixSecondsOrNull(snapshot.statusUpdatedAtSec),
    initiatedAtSec: unixSecondsOrNull(snapshot.initiatedAtSec),
    bankPaidAtSec: unixSecondsOrNull(snapshot.bankPaidAtSec),
    expiresAtSec: unixSecondsOrNull(snapshot.expiresAtSec),
    extensionSec: snapshot.extensionSec,
    amountSat: snapshot.amountSat,
    spdPayload: snapshot.spdPayload,
  });
