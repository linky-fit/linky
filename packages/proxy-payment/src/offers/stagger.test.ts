import { describe, expect, it } from "vitest";
import { BankOfferId } from "@linky/linkstr";
import { me, other, payer, snapshot, START } from "../testing/offers";
import {
  applyBankPaymentOfferSnapshot,
  emptyBankPaymentOfferState,
} from "./state";
import {
  bankPaymentOfferStaggerDue,
  bankPaymentOfferStaggerQueue,
  isBankPaymentOfferStaggerQueueOpen,
  isBankPaymentOfferStaggerRecordExpired,
} from "./stagger";

const queue = bankPaymentOfferStaggerQueue({
  amountSat: 100,
  amountText: "250 Kč",
  delaySec: 10,
  firstSentAtSec: START,
  offerId: BankOfferId.make("offer-1"),
  ownerPubkey: me,
  peers: [payer, other],
});

describe("bank payment offer stagger", () => {
  it("schedules delayed recipients against the first send's expiry", () => {
    expect(queue).toMatchObject({
      expiresAtSec: START + 300,
      pending: [
        { dueAtSec: START + 10, peer: payer },
        { dueAtSec: START + 20, peer: other },
      ],
    });
    expect(
      bankPaymentOfferStaggerQueue({
        ...queue!,
        delaySec: 10,
        firstSentAtSec: START,
        peers: [],
      }),
    ).toBeNull();
    expect(isBankPaymentOfferStaggerRecordExpired(queue!, START + 299)).toBe(
      false,
    );
    expect(isBankPaymentOfferStaggerRecordExpired(queue!, START + 300)).toBe(
      true,
    );
    expect(isBankPaymentOfferStaggerRecordExpired(queue!, START - 1)).toBe(
      true,
    );
  });

  it("tells due recipients apart from already offered ones and reports the next due time", () => {
    const offered = applyBankPaymentOfferSnapshot(
      emptyBankPaymentOfferState,
      snapshot("offered", true),
      me,
      START,
    ).state.offers;
    expect(bankPaymentOfferStaggerDue(queue!, [], START + 5)).toEqual({
      alreadyOffered: [],
      nextDueAtSec: START + 10,
      send: [],
    });
    expect(bankPaymentOfferStaggerDue(queue!, offered, START + 10)).toEqual({
      alreadyOffered: [payer],
      nextDueAtSec: START + 20,
      send: [],
    });
    expect(bankPaymentOfferStaggerDue(queue!, [], START + 20)).toEqual({
      alreadyOffered: [],
      nextDueAtSec: null,
      send: [payer, other],
    });
  });

  it("closes the queue once any recipient moved past offered or declined", () => {
    const apply = (...events: ReturnType<typeof snapshot>[]) =>
      events.reduce(
        (state, event) =>
          applyBankPaymentOfferSnapshot(state, event, me, START).state,
        emptyBankPaymentOfferState,
      ).offers;
    expect(
      isBankPaymentOfferStaggerQueueOpen(
        queue!,
        apply(snapshot("offered", true)),
      ),
    ).toBe(true);
    expect(
      isBankPaymentOfferStaggerQueueOpen(
        queue!,
        apply(snapshot("offered", true), snapshot("declined", false)),
      ),
    ).toBe(true);
    expect(
      isBankPaymentOfferStaggerQueueOpen(
        queue!,
        apply(snapshot("offered", true), snapshot("accepted", false)),
      ),
    ).toBe(false);
  });
});
