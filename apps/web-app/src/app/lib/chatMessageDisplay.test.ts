import { getPublicKey } from "nostr-tools";
import { describe, expect, it } from "vitest";
import { createLinkyBankPaymentOfferEvent } from "../../testUtils/bankPaymentOfferEvent";
import { createSecretKey } from "../../testUtils/nostrKeys";
import { formatChatMessagePreviewText } from "./chatMessageDisplay";

const translatePreview = (key: string): string => {
  switch (key) {
    case "bankPaymentOfferPreviewIncoming":
      return "Poptává proxy platbu za {amount}";
    case "bankPaymentOfferPreviewOutgoing":
      return "Poptáváte proxy platbu za {amount}";
    case "bankPaymentOfferPreviewCanceled":
      return "Zrušená proxy platba";
    default:
      return key;
  }
};

const createOfferContent = (
  status: "canceled" | "offered" | "settled",
  bankPaidAtSec: number | null = null,
): string =>
  createLinkyBankPaymentOfferEvent({
    amountText: "123 Kč",
    bankPaidAtSec,
    clientId: `client-${status}`,
    createdAt: 1_700_000_000,
    recipientPublicKey: getPublicKey(createSecretKey(2)),
    senderPublicKey: getPublicKey(createSecretKey(1)),
    status,
  }).content;

describe("formatChatMessagePreviewText", () => {
  it("shows an incoming proxy offer as a readable conversation preview", () => {
    expect(
      formatChatMessagePreviewText({
        content: createOfferContent("offered"),
        direction: "in",
        formatDisplayedAmountText: (amount) => `${amount} sat`,
        t: translatePreview,
      }),
    ).toBe("Poptává proxy platbu za 123 Kč");
  });

  it("shows a canceled offer without its raw payload", () => {
    expect(
      formatChatMessagePreviewText({
        content: createOfferContent("canceled"),
        direction: "in",
        formatDisplayedAmountText: (amount) => `${amount} sat`,
        t: translatePreview,
      }),
    ).toBe("Zrušená proxy platba");
  });

  it("previews a settled offer this peer did not pay as taken by someone else", () => {
    const preview = (bankPaidAtSec: number | null) =>
      formatChatMessagePreviewText({
        content: createOfferContent("settled", bankPaidAtSec),
        direction: "out",
        formatDisplayedAmountText: (amount) => `${amount} sat`,
        t: translatePreview,
      });
    expect(preview(null)).toBe(
      "bankPaymentOfferTitle: bankPaymentOfferStatusAcceptedByOther",
    );
    expect(preview(1_700_000_050)).toBe(
      "bankPaymentOfferTitle: bankPaymentOfferStatusSettled",
    );
  });
});
