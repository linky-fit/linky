import { UnixSeconds } from "@linky/linkstr";
import { describe, expect, it } from "vitest";
import { snapshot, START } from "../testing/offers";
import {
  bankOfferContentFromSnapshot,
  decodeBankPaymentOffer,
} from "./content";
import {
  bankPaymentOfferResponseDurationSec,
  isBankPaymentOfferExpired,
} from "./offer";

const decode = (event: ReturnType<typeof snapshot>) => {
  const info = decodeBankPaymentOffer(bankOfferContentFromSnapshot(event));
  if (!info) throw new Error("undecodable snapshot");
  return info;
};

describe("decodeBankPaymentOffer", () => {
  it("round-trips a snapshot and falls back to the wire copy for a missing text", () => {
    expect(decode(snapshot("offered", true, { text: null }))).toMatchObject({
      amountSat: 1000,
      amountText: "500 CZK",
      offerId: "offer-1",
      status: "offered",
      statusUpdatedAtSec: START,
      text: "Zaplatíš za mě bankovní platbu ve výši 500 CZK?",
    });
    expect(decodeBankPaymentOffer("not json")).toBeNull();
    expect(decodeBankPaymentOffer('{"type":"other"}')).toBeNull();
  });

  it("keeps initiation and bank-payment confirmation times in later states", () => {
    const info = decode(
      snapshot("settled", true, {
        bankPaidAtSec: UnixSeconds.make(START + 125),
        initiatedAtSec: START,
      }),
    );
    expect(info.initiatedAtSec).toBe(START);
    expect(info.bankPaidAtSec).toBe(START + 125);
    expect(bankPaymentOfferResponseDurationSec(info, 0)).toBe(125);
  });
});

describe("isBankPaymentOfferExpired", () => {
  it("recognizes an offer whose active phase has expired", () => {
    const info = decode(snapshot("offered", true));
    expect(isBankPaymentOfferExpired(info, START, START + 299)).toBe(false);
    expect(isBankPaymentOfferExpired(info, START, START + 300)).toBe(true);
  });

  it("uses an explicit extended deadline when present", () => {
    const info = decode(
      snapshot("bank_details_sent", true, {
        expiresAtSec: UnixSeconds.make(START + 360),
        extensionSec: 60,
      }),
    );
    expect(info.extensionSec).toBe(60);
    expect(isBankPaymentOfferExpired(info, START, START + 359)).toBe(false);
    expect(isBankPaymentOfferExpired(info, START, START + 360)).toBe(true);
  });

  it.each(["accepted_by_other", "canceled"] as const)(
    "does not label the terminal %s state as expired",
    (status) => {
      const info = decode(snapshot(status, true));
      expect(isBankPaymentOfferExpired(info, START, START + 1e6)).toBe(false);
    },
  );
});
