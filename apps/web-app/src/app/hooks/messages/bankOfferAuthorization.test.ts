import { makeIdentity } from "@linky/linkstr/testing";
import {
  BankOfferId,
  BankOfferSnapshotReceived,
  OwnBankOfferSnapshotConfirmed,
  RumorId,
  UnixSeconds,
  type BankOfferInboxEvent,
  type BankOfferStatus,
} from "@linky/linkstr";
import { describe, expect, it } from "vitest";
import { BankOfferAuthorization } from "./bankOfferAuthorization";
import { bankOfferContentFromSnapshot } from "./inboxNotifications";

const me = makeIdentity().pubkey;
const payer = makeIdentity().pubkey;
const other = makeIdentity().pubkey;
const start = UnixSeconds.make(1_800_000_000);
let sequence = 0;
const snapshot = (
  status: BankOfferStatus,
  self: boolean,
  overrides: Partial<
    ConstructorParameters<typeof BankOfferSnapshotReceived>[0]
  > = {},
): BankOfferInboxEvent => {
  const fields = {
    snapshotId: RumorId.make((++sequence).toString(16).padStart(64, "0")),
    offerId: BankOfferId.make("offer-1"),
    offerer: me,
    status,
    amountText: "500 CZK",
    text: "offer",
    amountSat: 1000,
    initiatedAtSec: start,
    bankPaidAtSec: null,
    expiresAtSec: null,
    extensionSec: null,
    spdPayload: null,
    statusUpdatedAtSec: start,
    clientId: null,
    sentAt: start,
    ...overrides,
  };
  return self
    ? new OwnBankOfferSnapshotConfirmed({
        ...fields,
        to: overrides.from ?? payer,
      })
    : new BankOfferSnapshotReceived({
        ...fields,
        from: overrides.from ?? payer,
      });
};

const receive = (state: BankOfferAuthorization, event: BankOfferInboxEvent) =>
  state.receive(
    event,
    me,
    event._tag === "BankOfferSnapshotReceived" ? event.from : event.to,
    [],
  );

const authorizePayer = (state: BankOfferAuthorization) => {
  receive(state, snapshot("offered", true));
  receive(state, snapshot("accepted", false));
  receive(state, snapshot("bank_details_sent", true));
};

describe("bank offer authorization", () => {
  it("does not create a fabricated outgoing paid offer", () => {
    const state = new BankOfferAuthorization();
    expect(receive(state, snapshot("bank_paid", false))).toEqual([]);
    expect(receive(state, snapshot("accepted", false))).toEqual([]);
  });

  it("rejects payer changes to the authorized amount and terms", () => {
    const state = new BankOfferAuthorization();
    authorizePayer(state);
    for (const overrides of [
      { amountSat: 100_000 },
      { amountText: "5000 CZK" },
      { initiatedAtSec: UnixSeconds.make(start + 999) },
      { offerer: other },
    ])
      expect(receive(state, snapshot("bank_paid", false, overrides))).toEqual(
        [],
      );
    expect(receive(state, snapshot("bank_paid", false))).toHaveLength(1);
  });

  it("does not let a recipient cancel, settle, or replace an offer", () => {
    const state = new BankOfferAuthorization();
    receive(state, snapshot("offered", true));
    expect(receive(state, snapshot("canceled", false))).toEqual([]);
    expect(receive(state, snapshot("settled", false))).toEqual([]);
    expect(receive(state, snapshot("offered", false))).toEqual([]);
    expect(receive(state, snapshot("accepted", false))).toHaveLength(1);
  });

  it("requires bank details authorization for the specific winning recipient", () => {
    const state = new BankOfferAuthorization();
    authorizePayer(state);
    receive(state, snapshot("offered", true, { from: other }));
    expect(
      receive(state, snapshot("bank_paid", false, { from: other })),
    ).toEqual([]);
    expect(receive(state, snapshot("bank_paid", false))).toHaveLength(1);
  });

  it("hydrates reverse-order history only once the offerer authorizes its terms and payer", () => {
    const state = new BankOfferAuthorization();
    const paid = snapshot("bank_paid", false, {
      sentAt: UnixSeconds.make(start + 2),
    });
    expect(receive(state, paid)).toEqual([]);
    expect(receive(state, snapshot("accepted", false))).toEqual([]);
    expect(
      receive(
        state,
        snapshot("bank_details_sent", true, {
          sentAt: UnixSeconds.make(start + 1),
        }),
      ).map((event) => event.status),
    ).toEqual(["bank_details_sent", "bank_paid"]);
    expect(receive(state, snapshot("offered", true))).toEqual([]);
  });

  it("does not change original terms in a later authenticated offerer snapshot", () => {
    const state = new BankOfferAuthorization();
    receive(state, snapshot("offered", true));
    expect(
      receive(state, snapshot("bank_details_sent", true, { amountSat: 9000 })),
    ).toEqual([]);
    expect(
      receive(
        state,
        snapshot("bank_details_sent", true, {
          initiatedAtSec: UnixSeconds.make(start + 1),
        }),
      ),
    ).toEqual([]);
    expect(receive(state, snapshot("bank_paid", false))).toEqual([]);
    expect(
      receive(state, snapshot("bank_details_sent", true)).map(
        (event) => event.status,
      ),
    ).toEqual(["bank_details_sent", "bank_paid"]);
  });

  it("keeps equal-second delayed offered and accepted snapshots from rolling back the chosen payer", () => {
    const state = new BankOfferAuthorization();
    receive(state, snapshot("bank_details_sent", true));
    expect(receive(state, snapshot("offered", true))).toEqual([]);
    expect(receive(state, snapshot("accepted", false))).toEqual([]);
    expect(receive(state, snapshot("bank_paid", false))).toHaveLength(1);
  });

  it("preserves expiry, extension and bank details from the offerer", () => {
    const state = new BankOfferAuthorization();
    receive(
      state,
      snapshot("bank_details_sent", true, {
        expiresAtSec: UnixSeconds.make(start + 60),
        extensionSec: 30,
        spdPayload: "SPD*trusted",
      }),
    );
    expect(
      receive(
        state,
        snapshot("bank_paid", false, {
          expiresAtSec: UnixSeconds.make(start + 99_999),
          extensionSec: 99_999,
          spdPayload: "SPD*attacker",
          statusUpdatedAtSec: UnixSeconds.make(start + 99_999),
        }),
      )[0],
    ).toMatchObject({
      expiresAtSec: start + 60,
      extensionSec: 30,
      spdPayload: "SPD*trusted",
      statusUpdatedAtSec: start,
    });
  });

  it("uses a locally sent offer before its self copy arrives", () => {
    const state = new BankOfferAuthorization();
    const offered = snapshot("offered", true);
    expect(
      state.receive(snapshot("accepted", false), me, payer, [
        {
          contactId: payer,
          content: bankOfferContentFromSnapshot(offered),
          createdAtSec: start,
          direction: "out",
          id: "local",
          pubkey: me,
          status: "sent",
          wrapId: "",
          rumorId: "",
        },
      ]),
    ).toHaveLength(1);
  });

  it("does not let another offerer collide with a grouped offer id", () => {
    const state = new BankOfferAuthorization();
    receive(state, snapshot("offered", true));
    expect(
      receive(state, snapshot("canceled", false, { offerer: payer })),
    ).toEqual([]);
  });

  it("keeps another recipient's thread usable after a decline", () => {
    const state = new BankOfferAuthorization();
    receive(state, snapshot("offered", true));
    receive(state, snapshot("offered", true, { from: other }));
    expect(receive(state, snapshot("declined", false))).toHaveLength(1);
    expect(
      receive(state, snapshot("accepted", false, { from: other })),
    ).toHaveLength(1);
  });
});
