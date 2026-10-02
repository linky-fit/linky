import type { Translate } from "../../i18n";
import { formatShortNpub, previewTokenText } from "../../utils/formatting";
import { normalizeNpubIdentifier } from "../../utils/nostrNpub";
import {
  decodeBankPaymentOffer,
  type BankPaymentOffer,
} from "@linky-fit/proxy-payment";
import { getBankPaymentOfferStatusLabel } from "./bankPaymentOfferLabels";
import {
  parseCashuPaymentRequestMessage,
  parseLinkyPaymentRequestDeclineMessage,
} from "./paymentRequestMessage";
import {
  parsePrivateImageMessage,
  privateImagePreviewText,
} from "./privateImageMessage";
import { extractCashuTokenFromText } from "./tokenText";

const PREVIEW_NPUB_PATTERN =
  /(?:nostr:)?npub1[023456789acdefghjklmnpqrstuvwxyz]+(?:@npub\.cash)?/gi;
const PREVIEW_CASHU_PATTERN = /cashu[0-9A-Za-z_-]+={0,2}/gi;

const formatInlinePreviewEntities = (content: string): string => {
  const withShortNpubs = content.replace(PREVIEW_NPUB_PATTERN, (match) => {
    const normalized = normalizeNpubIdentifier(match);
    return normalized ? formatShortNpub(normalized) : match;
  });

  return withShortNpubs.replace(PREVIEW_CASHU_PATTERN, (match) => {
    const token = extractCashuTokenFromText(match);
    return previewTokenText(token) ?? match;
  });
};

interface FormatChatMessagePreviewArgs {
  content: string;
  direction?: "in" | "out" | null;
  formatDisplayedAmountText: (amountSat: number) => string;
  t: Translate;
}

export const formatBankPaymentOfferPreviewText = (
  offer: Pick<BankPaymentOffer, "amountText" | "status">,
  direction: FormatChatMessagePreviewArgs["direction"],
  t: Translate,
): string => {
  if (offer.status === "offered") {
    const key =
      direction === "out"
        ? "bankPaymentOfferPreviewOutgoing"
        : "bankPaymentOfferPreviewIncoming";
    return t(key).replace("{amount}", offer.amountText);
  }
  if (offer.status === "canceled") {
    return t("bankPaymentOfferPreviewCanceled");
  }

  return `${t("bankPaymentOfferTitle")}: ${getBankPaymentOfferStatusLabel(offer.status, false, t)}`;
};

export const formatChatMessagePreviewText = ({
  content,
  direction,
  formatDisplayedAmountText,
  t,
}: FormatChatMessagePreviewArgs): string => {
  const privateImage = parsePrivateImageMessage(content);
  if (privateImage) {
    return privateImagePreviewText(t, privateImage);
  }

  const bankPaymentOffer = decodeBankPaymentOffer(content);
  if (bankPaymentOffer) {
    return formatBankPaymentOfferPreviewText(bankPaymentOffer, direction, t);
  }

  const paymentRequest = parseCashuPaymentRequestMessage(content);
  if (paymentRequest) {
    const amountText = formatDisplayedAmountText(paymentRequest.amount);
    return direction === "out"
      ? t("paymentRequestPreviewOutgoing").replace("{amount}", amountText)
      : t("paymentRequestPreviewIncoming").replace("{amount}", amountText);
  }

  if (parseLinkyPaymentRequestDeclineMessage(content)) {
    return direction === "out"
      ? t("paymentRequestDeclinedPreviewOutgoing")
      : t("paymentRequestDeclinedPreviewIncoming");
  }

  return formatInlinePreviewEntities(content);
};
