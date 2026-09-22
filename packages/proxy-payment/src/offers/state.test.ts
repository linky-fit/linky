import { UnixSeconds } from "@linky/linkstr";
import { describe, expect, it } from "vitest";
import {
  me,
  other,
  payer,
  receiptFor,
  snapshot,
  START,
} from "../testing/offers";
import { bankPaymentOfferedDraft } from "./drafts";
import {
  applyBankPaymentOfferReceipt,
  applyBankPaymentOfferSnapshot,
  emptyBankPaymentOfferState,
  type BankPaymentOfferState,
} from "./state";

const NOW = START + 10;

class Book {
  state: BankPaymentOfferState = emptyBankPaymentOfferState;

  apply(event: ReturnType<typeof snapshot>, nowSec = NOW) {
    const result = applyBankPaymentOfferSnapshot(this.state, event, me, nowSec);
    this.state = result.state;
    return result.accepted.map(({ offer }) => offer);
  }

  authorizePayer() {
    this.apply(snapshot("offered", true));
    this.apply(snapshot("accepted", false));
    this.apply(snapshot("bank_details_sent", true));
  }
}

describe("applyBankPaymentOfferSnapshot", () => {
  it("does not create a fabricated outgoing paid offer", () => {
    const book = new Book();
    expect(book.apply(snapshot("bank_paid", false))).toEqual([]);
    expect(book.apply(snapshot("accepted", false))).toEqual([]);
    expect(book.state.offers).toEqual([]);
  });

  it("rejects payer changes to the authorized amount and terms", () => {
    const book = new Book();
    book.authorizePayer();
    for (const overrides of [
      { amountSat: 100_000 },
      { amountText: "5000 CZK" },
      { initiatedAtSec: UnixSeconds.make(START + 999) },
      { offerer: other },
    ]) {
      expect(book.apply(snapshot("bank_paid", false, overrides))).toEqual([]);
    }
    expect(book.apply(snapshot("bank_paid", false))).toHaveLength(1);
  });

  it("does not let a recipient cancel, settle, or replace an offer", () => {
    const book = new Book();
    book.apply(snapshot("offered", true));
    expect(book.apply(snapshot("canceled", false))).toEqual([]);
    expect(book.apply(snapshot("settled", false))).toEqual([]);
    expect(book.apply(snapshot("offered", false))).toEqual([]);
    expect(book.apply(snapshot("accepted", false))).toHaveLength(1);
  });

  it("requires bank details authorization for the specific winning recipient", () => {
    const book = new Book();
    book.authorizePayer();
    book.apply(snapshot("offered", true, { from: other }));
    expect(book.apply(snapshot("bank_paid", false, { from: other }))).toEqual(
      [],
    );
    expect(book.apply(snapshot("bank_paid", false))).toHaveLength(1);
  });

  it("hydrates reverse-order history only once the offerer authorizes its terms and payer", () => {
    const book = new Book();
    const paid = snapshot("bank_paid", false, {
      sentAt: UnixSeconds.make(START + 2),
    });
    expect(book.apply(paid)).toEqual([]);
    expect(book.apply(snapshot("accepted", false))).toEqual([]);
    expect(book.state.pending).toHaveLength(2);
    expect(
      book
        .apply(
          snapshot("bank_details_sent", true, {
            sentAt: UnixSeconds.make(START + 1),
          }),
        )
        .map((offer) => offer.status),
    ).toEqual(["bank_details_sent", "bank_paid"]);
    expect(book.state.pending).toEqual([]);
    expect(book.apply(snapshot("offered", true))).toEqual([]);
  });

  it("does not change original terms in a later authenticated offerer snapshot", () => {
    const book = new Book();
    book.apply(snapshot("offered", true));
    expect(
      book.apply(snapshot("bank_details_sent", true, { amountSat: 9000 })),
    ).toEqual([]);
    expect(
      book.apply(
        snapshot("bank_details_sent", true, {
          initiatedAtSec: UnixSeconds.make(START + 1),
        }),
      ),
    ).toEqual([]);
    expect(book.apply(snapshot("bank_paid", false))).toEqual([]);
    expect(
      book
        .apply(snapshot("bank_details_sent", true))
        .map((offer) => offer.status),
    ).toEqual(["bank_details_sent", "bank_paid"]);
  });

  it("keeps equal-second delayed offered and accepted snapshots from rolling back the chosen payer", () => {
    const book = new Book();
    book.apply(snapshot("bank_details_sent", true));
    expect(book.apply(snapshot("offered", true))).toEqual([]);
    expect(book.apply(snapshot("accepted", false))).toEqual([]);
    expect(book.apply(snapshot("bank_paid", false))).toHaveLength(1);
  });

  it("preserves expiry, extension and bank details from the offerer", () => {
    const book = new Book();
    book.apply(
      snapshot("bank_details_sent", true, {
        expiresAtSec: UnixSeconds.make(START + 60),
        extensionSec: 30,
        spdPayload: "SPD*trusted",
      }),
    );
    expect(
      book.apply(
        snapshot("bank_paid", false, {
          expiresAtSec: UnixSeconds.make(START + 99_999),
          extensionSec: 99_999,
          spdPayload: "SPD*attacker",
          statusUpdatedAtSec: UnixSeconds.make(START + 99_999),
        }),
      )[0],
    ).toMatchObject({
      bankPaidAtSec: START,
      expiresAtSec: START + 60,
      extensionSec: 30,
      spdPayload: "SPD*trusted",
      statusUpdatedAtSec: START,
    });
  });

  it("authorizes a payer against an offer this device sent before its self copy arrives", () => {
    const draft = bankPaymentOfferedDraft({
      amountSat: 1000,
      amountText: "500 CZK",
      offerId: "offer-1",
      offerer: me,
      to: payer,
    });
    if (!draft) throw new Error("draft");
    const book = new Book();
    const sent = applyBankPaymentOfferReceipt(
      book.state,
      payer,
      receiptFor(draft),
    );
    book.state = sent.state;
    expect(sent.offer).toMatchObject({ peer: payer, status: "offered" });
    expect(book.apply(snapshot("accepted", false))).toHaveLength(1);
    // The echoed self copy is idempotent.
    expect(book.apply(snapshot("offered", true))).toEqual([]);
    expect(book.state.offers).toHaveLength(1);
  });

  it("does not let another offerer collide with a grouped offer id", () => {
    const book = new Book();
    book.apply(snapshot("offered", true));
    expect(book.apply(snapshot("canceled", false, { offerer: payer }))).toEqual(
      [],
    );
  });

  it("keeps another recipient's thread usable after a decline", () => {
    const book = new Book();
    book.apply(snapshot("offered", true));
    book.apply(snapshot("offered", true, { from: other }));
    expect(book.apply(snapshot("declined", false))).toHaveLength(1);
    expect(
      book.apply(snapshot("accepted", false, { from: other })),
    ).toHaveLength(1);
    expect(
      book.state.offers.map((offer) => [offer.peer, offer.status]),
    ).toEqual([
      [payer, "declined"],
      [other, "accepted"],
    ]);
  });

  it("keeps one thread per peer with the latest status and the earliest creation time", () => {
    const book = new Book();
    book.apply(snapshot("offered", true));
    book.apply(snapshot("offered", true, { from: other }));
    book.apply(
      snapshot("accepted", false, { sentAt: UnixSeconds.make(START + 5) }),
    );
    book.apply(
      snapshot("bank_details_sent", true, {
        sentAt: UnixSeconds.make(START + 10),
      }),
    );
    // A replayed older snapshot never rolls the thread back.
    expect(
      book.apply(
        snapshot("accepted", false, { sentAt: UnixSeconds.make(START + 5) }),
      ),
    ).toEqual([]);
    expect(book.state.offers).toHaveLength(2);
    expect(
      book.state.offers.find((offer) => offer.peer === payer),
    ).toMatchObject({ createdAtSec: START, status: "bank_details_sent" });
  });

  it("uses status rank to resolve snapshots with the same timestamp", () => {
    const book = new Book();
    book.apply(snapshot("settled", true));
    expect(book.apply(snapshot("offered", true))).toEqual([]);
    expect(book.state.offers[0]?.status).toBe("settled");
  });

  it("drops a non-terminal snapshot once the whole offer ended for another peer", () => {
    const book = new Book();
    book.apply(snapshot("canceled", true));
    expect(book.apply(snapshot("offered", true, { from: other }))).toEqual([]);
    expect(
      book.apply(snapshot("accepted_by_other", true, { from: other })),
    ).toHaveLength(1);
  });

  it("drops snapshots whose phase already expired", () => {
    const book = new Book();
    expect(book.apply(snapshot("offered", true), START + 300)).toEqual([]);
    expect(book.apply(snapshot("offered", true), START + 299)).toHaveLength(1);
  });
});
