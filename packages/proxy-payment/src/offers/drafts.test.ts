import { UnixSeconds } from "@linky/linkstr";
import { describe, expect, it } from "vitest";
import { me, payer, snapshot, START } from "../testing/offers";
import { bankPaymentOfferResponseDraft } from "./drafts";
import {
  applyBankPaymentOfferSnapshot,
  emptyBankPaymentOfferState,
} from "./state";

const offer = (...steps: [Parameters<typeof snapshot>[0], boolean][]) => {
  const state = steps.reduce(
    (current, [status, self]) =>
      applyBankPaymentOfferSnapshot(
        current,
        snapshot(status, self, {
          expiresAtSec: UnixSeconds.make(START + 200),
          spdPayload: "SPD*1.0*ACC:CZ6508000000192000145399",
        }),
        me,
        START,
      ).state,
    emptyBankPaymentOfferState,
  );
  const [first] = state.offers;
  if (!first) throw new Error("snapshot rejected");
  return first;
};

describe("bankPaymentOfferResponseDraft", () => {
  it("lets the offerer send offerer statuses to the peer with the known terms", () => {
    const draft = bankPaymentOfferResponseDraft(
      offer(["offered", true]),
      "canceled",
      me,
    );
    expect(draft).toMatchObject({
      amountSat: 1000,
      initiatedAtSec: START,
      offerer: me,
      spdPayload: "SPD*1.0*ACC:CZ6508000000192000145399",
      status: "canceled",
      to: payer,
    });
    expect(draft?.expiresAtSec).toBeUndefined();
  });

  it("refuses statuses of the other role and lets options extend the phase", () => {
    const known = offer(["offered", true]);
    expect(bankPaymentOfferResponseDraft(known, "accepted", me)).toBeNull();
    expect(bankPaymentOfferResponseDraft(known, "canceled", payer)).toBeNull();
    const extended = bankPaymentOfferResponseDraft(known, "offered", me, {
      expiresAtSec: START + 260,
      extensionSec: 60,
      withPush: true,
    });
    expect(extended).toMatchObject({
      expiresAtSec: START + 260,
      extensionSec: 60,
      pushMark: true,
      text: "Potřebuji víc času (+60 s).",
    });
  });

  it("stamps the bank-paid time when the payer reports payment", () => {
    // From the payer's device: the offerer's snapshots arrive, mine are echoed.
    const asPayer = (status: Parameters<typeof snapshot>[0], mine: boolean) =>
      snapshot(status, mine, { from: me });
    const state = [
      asPayer("offered", false),
      asPayer("accepted", true),
      asPayer("bank_details_sent", false),
    ].reduce(
      (current, event) =>
        applyBankPaymentOfferSnapshot(current, event, payer, START).state,
      emptyBankPaymentOfferState,
    );
    const [details] = state.offers;
    if (!details) throw new Error("snapshot rejected");
    expect(details).toMatchObject({ peer: me, status: "bank_details_sent" });
    const draft = bankPaymentOfferResponseDraft(details, "bank_paid", payer);
    expect(draft).toMatchObject({ offerer: me, status: "bank_paid", to: me });
    expect(draft?.bankPaidAtSec).toBeUndefined();
    expect(
      bankPaymentOfferResponseDraft(details, "canceled", payer),
    ).toBeNull();
  });
});
