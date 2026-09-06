import { Either } from "effect";
import { getEventHash } from "nostr-tools";
import { ClientId, Pubkey, UnixSeconds } from "../domain/primitives";
import { Rumor } from "../internal/nostrEvent";
import type { NostrTags } from "../internal/nostrEvent";
import {
  decodeBankOfferRumor,
  encodeBankOfferContent,
  encodeBankOfferRumor,
} from "./codec";
import { makeIdentity } from "../testing";
import { BankOfferDraft, BankOfferId } from "./domain";

const alice = makeIdentity();
const bob = makeIdentity();
const sentAt = UnixSeconds.make(1_754_000_000);
const clientId = ClientId.make("client-1");
const offerId = BankOfferId.make("offer-1");

const draft = new BankOfferDraft({
  to: bob.pubkey,
  offerId,
  offerer: alice.pubkey,
  status: "bank_paid",
  amountText: "1 000 Kč",
  text: "Bankovní platba byla označena jako zaplacená.",
  amountSat: 50_000,
  initiatedAtSec: UnixSeconds.make(sentAt - 120),
  expiresAtSec: UnixSeconds.make(sentAt + 300),
  extensionSec: 60,
  spdPayload: "SPD*1.0*ACC:CZ123",
});

const withHash = (fields: {
  readonly pubkey: Pubkey;
  readonly created_at: UnixSeconds;
  readonly kind: number;
  readonly tags: NostrTags;
  readonly content: string;
}): Rumor => new Rumor({ ...fields, id: getEventHash(fields) });

const legacyRumor = (overrides?: {
  readonly tags?: NostrTags;
  readonly content?: string;
  readonly pubkey?: Pubkey;
}): Rumor =>
  withHash({
    pubkey: overrides?.pubkey ?? alice.pubkey,
    created_at: sentAt,
    kind: 24135,
    tags: overrides?.tags ?? [
      ["p", bob.pubkey],
      ["p", alice.pubkey],
      ["client", clientId],
      ["offer", offerId],
      ["offerer", alice.pubkey],
      ["linky", "bank_payment_offer"],
      ["status", "offered"],
    ],
    content:
      overrides?.content ??
      `{"amountText":"1 000 Kč","offerId":"offer-1","offererPublicKey":"${alice.pubkey}","status":"offered","statusUpdatedAtSec":1754000000,"text":"Zaplatíš za mě bankovní platbu?","type":"linky.bank_payment_offer","version":1,"initiatedAtSec":1754000000,"expiresAtSec":1754000300,"amountSat":50000,"spdPayload":"SPD*1.0*ACC:CZ123"}`,
  });

describe("bank offer content encoding", () => {
  const content = {
    offerId,
    offerer: alice.pubkey,
    status: "offered" as const,
    amountText: "1 000 Kč",
    text: "Zaplatíš za mě bankovní platbu?",
    statusUpdatedAtSec: sentAt,
    initiatedAtSec: UnixSeconds.make(sentAt - 120),
    bankPaidAtSec: UnixSeconds.make(sentAt - 10),
    expiresAtSec: UnixSeconds.make(sentAt + 300),
    extensionSec: 60,
    amountSat: 50_000,
    spdPayload: "SPD*1.0*ACC:CZ123",
  };

  it("writes every field in wire order", () => {
    expect(encodeBankOfferContent(content)).toBe(
      `{"amountText":"1 000 Kč","offerId":"offer-1","offererPublicKey":"${alice.pubkey}","status":"offered","statusUpdatedAtSec":1754000000,"text":"Zaplatíš za mě bankovní platbu?","type":"linky.bank_payment_offer","version":1,"initiatedAtSec":1753999880,"bankPaidAtSec":1753999990,"expiresAtSec":1754000300,"extensionSec":60,"amountSat":50000,"spdPayload":"SPD*1.0*ACC:CZ123"}`,
    );
  });

  it("omits null fields, including the status timestamp", () => {
    expect(
      encodeBankOfferContent({
        ...content,
        statusUpdatedAtSec: null,
        initiatedAtSec: null,
        bankPaidAtSec: null,
        expiresAtSec: null,
        extensionSec: null,
        amountSat: null,
        spdPayload: null,
      }),
    ).toBe(
      `{"amountText":"1 000 Kč","offerId":"offer-1","offererPublicKey":"${alice.pubkey}","status":"offered","text":"Zaplatíš za mě bankovní platbu?","type":"linky.bank_payment_offer","version":1}`,
    );
  });
});

describe("bank offer rumor encoding", () => {
  it("preserves the legacy tag and content key order exactly", () => {
    const rumor = encodeBankOfferRumor(draft, alice.pubkey, sentAt, clientId);

    expect(rumor.tags).toEqual([
      ["p", bob.pubkey],
      ["p", alice.pubkey],
      ["client", clientId],
      ["offer", offerId],
      ["offerer", alice.pubkey],
      ["linky", "bank_payment_offer"],
      ["status", "bank_paid"],
    ]);
    expect(rumor.content).toBe(
      `{"amountText":"1 000 Kč","offerId":"offer-1","offererPublicKey":"${alice.pubkey}","status":"bank_paid","statusUpdatedAtSec":1754000000,"text":"Bankovní platba byla označena jako zaplacená.","type":"linky.bank_payment_offer","version":1,"initiatedAtSec":1753999880,"bankPaidAtSec":1754000000,"expiresAtSec":1754000300,"extensionSec":60,"amountSat":50000,"spdPayload":"SPD*1.0*ACC:CZ123"}`,
    );
    expect(rumor.id).toBe(getEventHash(rumor));
  });

  it.each([
    {
      status: "offered" as const,
      expected: { initiatedAtSec: sentAt },
    },
    {
      status: "bank_paid" as const,
      expected: { bankPaidAtSec: sentAt },
    },
    { status: "accepted" as const, expected: {} },
  ])("applies timestamp defaults for $status", ({ status, expected }) => {
    const rumor = encodeBankOfferRumor(
      new BankOfferDraft({
        to: bob.pubkey,
        offerId,
        offerer: alice.pubkey,
        status,
        amountText: "1 000 Kč",
        text: "verbatim text",
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(JSON.parse(rumor.content)).toEqual(
      expect.objectContaining({ statusUpdatedAtSec: sentAt, ...expected }),
    );
    if (status !== "offered") {
      expect(rumor.content).not.toContain("initiatedAtSec");
    }
    if (status !== "bank_paid") {
      expect(rumor.content).not.toContain("bankPaidAtSec");
    }
  });

  it("prefers explicit phase timestamps over status defaults", () => {
    const initiatedAtSec = UnixSeconds.make(sentAt - 20);
    const bankPaidAtSec = UnixSeconds.make(sentAt - 10);
    const rumor = encodeBankOfferRumor(
      new BankOfferDraft({
        to: bob.pubkey,
        offerId,
        offerer: alice.pubkey,
        status: "offered",
        amountText: "1 000 Kč",
        text: "verbatim text",
        initiatedAtSec,
        bankPaidAtSec,
      }),
      alice.pubkey,
      sentAt,
      clientId,
    );

    expect(JSON.parse(rumor.content)).toEqual(
      expect.objectContaining({ initiatedAtSec, bankPaidAtSec }),
    );
  });
});

describe("bank offer rumor decoding", () => {
  it("round-trips the encoded snapshot", () => {
    const rumor = encodeBankOfferRumor(draft, alice.pubkey, sentAt, clientId);

    expect(decodeBankOfferRumor(rumor, bob.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          _tag: "BankOfferSnapshotReceived",
          snapshotId: rumor.id,
          from: alice.pubkey,
          offerId,
          offerer: alice.pubkey,
          status: "bank_paid",
          amountText: "1 000 Kč",
          text: "Bankovní platba byla označena jako zaplacená.",
          amountSat: 50_000,
          initiatedAtSec: sentAt - 120,
          bankPaidAtSec: sentAt,
          expiresAtSec: sentAt + 300,
          extensionSec: 60,
          spdPayload: "SPD*1.0*ACC:CZ123",
          statusUpdatedAtSec: sentAt,
          clientId,
          sentAt,
        }),
      ),
    );
  });

  it("decodes the offerer's own self copy as a confirmation addressed to the recipient", () => {
    const rumor = encodeBankOfferRumor(draft, alice.pubkey, sentAt, clientId);

    expect(decodeBankOfferRumor(rumor, alice.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          _tag: "OwnBankOfferSnapshotConfirmed",
          to: bob.pubkey,
          offerer: alice.pubkey,
        }),
      ),
    );
  });

  it("decodes a legacy-built fixture", () => {
    const rumor = legacyRumor();

    expect(decodeBankOfferRumor(rumor, bob.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          snapshotId: rumor.id,
          offerId: "offer-1",
          status: "offered",
          amountText: "1 000 Kč",
          initiatedAtSec: sentAt,
          expiresAtSec: sentAt + 300,
          amountSat: 50_000,
        }),
      ),
    );
  });

  it("falls back to the offerer tag and tolerantly normalizes optional fields", () => {
    const rumor = legacyRumor({
      content: JSON.stringify({
        amountText: " 1 000 Kč ",
        offerId: " offer-1 ",
        status: "accepted",
        text: "   ",
        type: "linky.bank_payment_offer",
        amountSat: 50_000.9,
        initiatedAtSec: -1,
        bankPaidAtSec: Number.NaN,
        expiresAtSec: 1_754_000_300.9,
        extensionSec: "60",
        spdPayload: "  SPD  ",
      }),
    });

    expect(decodeBankOfferRumor(rumor, bob.pubkey)).toEqual(
      Either.right(
        expect.objectContaining({
          offerer: alice.pubkey,
          amountText: "1 000 Kč",
          text: null,
          amountSat: 50_000,
          initiatedAtSec: null,
          bankPaidAtSec: null,
          expiresAtSec: 1_754_000_300,
          extensionSec: null,
          spdPayload: "SPD",
        }),
      ),
    );
  });

  it.each([
    {
      name: "missing linky tag",
      rumor: legacyRumor({
        tags: [
          ["p", bob.pubkey],
          ["offerer", alice.pubkey],
        ],
      }),
    },
    {
      name: "wrong content type",
      rumor: legacyRumor({
        content: JSON.stringify({
          type: "linky.other",
          offerId: "offer-1",
          amountText: "1 Kč",
          status: "offered",
          offererPublicKey: alice.pubkey,
        }),
      }),
    },
    {
      name: "missing offer id",
      rumor: legacyRumor({
        content: JSON.stringify({
          type: "linky.bank_payment_offer",
          amountText: "1 Kč",
          status: "offered",
          offererPublicKey: alice.pubkey,
        }),
      }),
    },
    {
      name: "missing amount text",
      rumor: legacyRumor({
        content: JSON.stringify({
          type: "linky.bank_payment_offer",
          offerId: "offer-1",
          status: "offered",
          offererPublicKey: alice.pubkey,
        }),
      }),
    },
    {
      name: "invalid status",
      rumor: legacyRumor({
        content: JSON.stringify({
          type: "linky.bank_payment_offer",
          offerId: "offer-1",
          amountText: "1 Kč",
          status: "pending",
          offererPublicKey: alice.pubkey,
        }),
      }),
    },
    {
      name: "invalid offerer",
      rumor: legacyRumor({
        content: JSON.stringify({
          type: "linky.bank_payment_offer",
          offerId: "offer-1",
          amountText: "1 Kč",
          status: "offered",
          offererPublicKey: "not-a-pubkey",
        }),
      }),
    },
  ])("drops a snapshot with $name", ({ rumor }) => {
    expect(decodeBankOfferRumor(rumor, bob.pubkey)).toEqual(
      Either.left("invalid-bank-offer"),
    );
  });
});
