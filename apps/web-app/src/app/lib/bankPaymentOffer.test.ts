import { getPublicKey } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkyBankPaymentOfferEvent } from "../../testUtils/bankPaymentOfferEvent";
import { createSecretKey } from "../../testUtils/nostrKeys";
import type { LocalNostrMessage } from "../types/appTypes";
import {
  forgetLinkyBankPaymentOfferSpdPayload,
  forgetLinkyBankPaymentOfferStaggerQueue,
  getActiveBankPaymentOfferContacts,
  getLastBankPaymentOfferResponseSecByContactId,
  getLinkyBankPaymentOfferInfo,
  getLinkyBankPaymentOfferResponseDurationSec,
  isLinkyBankPaymentOfferExpired,
  markLinkyBankPaymentOfferBankDetailsSent,
  mergeBankPaymentOffersIntoLastMessageByContactId,
  readLinkyBankPaymentOfferSpdRecord,
  readLinkyBankPaymentOfferStaggerRecords,
  rememberLinkyBankPaymentOfferSpdPayload,
  rememberLinkyBankPaymentOfferStaggerQueue,
  removeLinkyBankPaymentOfferStaggerRecipients,
  type LinkyBankPaymentOfferStaggerRecord,
  type LinkyBankPaymentOfferStatus,
} from "./bankPaymentOffer";

const SENDER_PUBKEY = getPublicKey(createSecretKey(1));
const RECIPIENT_PUBKEY = getPublicKey(createSecretKey(2));

const createOffer = (status: LinkyBankPaymentOfferStatus) =>
  createLinkyBankPaymentOfferEvent({
    amountText: "250 Kč",
    clientId: "client-1",
    createdAt: 1_700_000_000,
    recipientPublicKey: RECIPIENT_PUBKEY,
    senderPublicKey: SENDER_PUBKEY,
    status,
  });

const createOfferMessage = (args: {
  contactId: string;
  createdAtSec: number;
  offerId: string;
  status: LinkyBankPaymentOfferStatus;
}): LocalNostrMessage => {
  const event = createLinkyBankPaymentOfferEvent({
    amountText: "250 Kč",
    clientId: `${args.offerId}-${args.contactId}-${args.status}`,
    createdAt: args.createdAtSec,
    offerId: args.offerId,
    recipientPublicKey: RECIPIENT_PUBKEY,
    senderPublicKey: SENDER_PUBKEY,
    status: args.status,
  });
  return {
    contactId: args.contactId,
    content: event.content,
    createdAtSec: args.createdAtSec,
    direction: "out",
    id: `${args.offerId}-${args.contactId}-${args.status}`,
    pubkey: SENDER_PUBKEY,
    rumorId: null,
    wrapId: `wrap-${args.offerId}-${args.contactId}-${args.status}`,
  };
};

describe("bank payment offer notifications", () => {
  it("recognizes an offer whose active phase has expired", () => {
    const info = getLinkyBankPaymentOfferInfo(createOffer("offered").content);
    expect(info).not.toBeNull();
    if (!info) return;

    expect(
      isLinkyBankPaymentOfferExpired(info, 1_700_000_000, 1_700_000_299),
    ).toBe(false);
    expect(
      isLinkyBankPaymentOfferExpired(info, 1_700_000_000, 1_700_000_300),
    ).toBe(true);
  });

  it("returns every contact currently participating in a proxy payment", () => {
    const messages = [
      createOfferMessage({
        contactId: "contact-1",
        createdAtSec: 1_700_000_000,
        offerId: "offer-1",
        status: "offered",
      }),
      createOfferMessage({
        contactId: "contact-2",
        createdAtSec: 1_700_000_000,
        offerId: "offer-1",
        status: "offered",
      }),
      createOfferMessage({
        contactId: "contact-2",
        createdAtSec: 1_700_000_010,
        offerId: "offer-1",
        status: "declined",
      }),
      createOfferMessage({
        contactId: "contact-3",
        createdAtSec: 1_700_000_020,
        offerId: "offer-2",
        status: "accepted",
      }),
    ];

    const active = getActiveBankPaymentOfferContacts(messages, 1_700_000_030);

    expect([...active.contactIds]).toEqual(["contact-1", "contact-3"]);
    expect(active.nextExpiryAtSec).toBe(1_700_000_300);
  });

  it("removes an expired or globally completed proxy payment", () => {
    const offered = createOfferMessage({
      contactId: "contact-1",
      createdAtSec: 1_700_000_000,
      offerId: "offer-1",
      status: "offered",
    });
    expect(
      getActiveBankPaymentOfferContacts([offered], 1_700_000_300).contactIds
        .size,
    ).toBe(0);

    const canceled = createOfferMessage({
      contactId: "contact-2",
      createdAtSec: 1_700_000_050,
      offerId: "offer-1",
      status: "canceled",
    });
    expect(
      getActiveBankPaymentOfferContacts([offered, canceled], 1_700_000_060)
        .contactIds.size,
    ).toBe(0);
  });

  it("includes proxy offers in the latest-message map used for conversations", () => {
    const existingMessage: LocalNostrMessage = {
      contactId: "contact-1",
      content: "newer regular message",
      createdAtSec: 1_700_000_100,
      direction: "in",
      id: "message-1",
      pubkey: SENDER_PUBKEY,
      rumorId: "rumor-1",
      wrapId: "wrap-1",
    };
    const unknownOffer: LocalNostrMessage = {
      ...createOfferMessage({
        contactId: `unknown:${"a".repeat(64)}`,
        createdAtSec: 1_700_000_050,
        offerId: "offer-unknown",
        status: "offered",
      }),
      direction: "in",
      pubkey: "a".repeat(64),
    };

    const merged = mergeBankPaymentOffersIntoLastMessageByContactId(
      new Map([["contact-1", existingMessage]]),
      [
        createOfferMessage({
          contactId: "contact-1",
          createdAtSec: 1_700_000_000,
          offerId: "offer-older",
          status: "offered",
        }),
        unknownOffer,
      ],
    );

    expect(merged.get("contact-1")).toBe(existingMessage);
    expect(merged.get(unknownOffer.contactId)).toBe(unknownOffer);
  });

  it("uses an explicit extended deadline when present", () => {
    const event = createLinkyBankPaymentOfferEvent({
      amountText: "250 Kč",
      clientId: "client-extended",
      createdAt: 1_700_000_250,
      expiresAtSec: 1_700_000_360,
      extensionSec: 60,
      offerId: "offer-extended",
      recipientPublicKey: RECIPIENT_PUBKEY,
      senderPublicKey: SENDER_PUBKEY,
      status: "bank_details_sent",
    });
    const info = getLinkyBankPaymentOfferInfo(event.content);
    expect(info).not.toBeNull();
    if (!info) return;

    expect(info.expiresAtSec).toBe(1_700_000_360);
    expect(info.extensionSec).toBe(60);
    expect(
      isLinkyBankPaymentOfferExpired(info, 1_700_000_000, 1_700_000_359),
    ).toBe(false);
    expect(
      isLinkyBankPaymentOfferExpired(info, 1_700_000_000, 1_700_000_360),
    ).toBe(true);
  });

  it.each(["accepted_by_other", "canceled"] as const)(
    "does not label the terminal %s state as expired",
    (status) => {
      const info = getLinkyBankPaymentOfferInfo(createOffer(status).content);
      expect(info).not.toBeNull();
      if (!info) return;

      expect(
        isLinkyBankPaymentOfferExpired(info, 1_700_000_000, 1_800_000_000),
      ).toBe(false);
    },
  );

  it("keeps initiation and bank-payment confirmation times in later states", () => {
    const event = createLinkyBankPaymentOfferEvent({
      amountText: "250 Kč",
      bankPaidAtSec: 1_700_000_125,
      clientId: "client-settled",
      createdAt: 1_700_000_150,
      initiatedAtSec: 1_700_000_000,
      offerId: "offer-settled",
      recipientPublicKey: RECIPIENT_PUBKEY,
      senderPublicKey: SENDER_PUBKEY,
      status: "settled",
    });
    const info = getLinkyBankPaymentOfferInfo(event.content);
    expect(info).not.toBeNull();
    if (!info) return;

    expect(info.initiatedAtSec).toBe(1_700_000_000);
    expect(info.bankPaidAtSec).toBe(1_700_000_125);
    expect(getLinkyBankPaymentOfferResponseDurationSec(info, 0)).toBe(125);
  });

  it("finds the most recent completed response for each outgoing candidate", () => {
    const createMessage = (args: {
      bankPaidAtSec: number;
      contactId: string;
      durationSec: number;
      direction?: "in" | "out";
    }) => {
      const initiatedAtSec = args.bankPaidAtSec - args.durationSec;
      const event = createLinkyBankPaymentOfferEvent({
        amountText: "250 Kč",
        bankPaidAtSec: args.bankPaidAtSec,
        clientId: `${args.contactId}-${args.bankPaidAtSec}`,
        createdAt: args.bankPaidAtSec + 10,
        initiatedAtSec,
        recipientPublicKey: RECIPIENT_PUBKEY,
        senderPublicKey: SENDER_PUBKEY,
        status: "settled",
      });
      return {
        contactId: args.contactId,
        content: event.content,
        createdAtSec: initiatedAtSec,
        direction: args.direction ?? "out",
      };
    };

    const durations = getLastBankPaymentOfferResponseSecByContactId([
      createMessage({
        bankPaidAtSec: 1_700_000_100,
        contactId: "contact-1",
        durationSec: 45,
      }),
      createMessage({
        bankPaidAtSec: 1_700_000_200,
        contactId: "contact-1",
        durationSec: 125,
      }),
      createMessage({
        bankPaidAtSec: 1_700_000_300,
        contactId: "contact-2",
        direction: "in",
        durationSec: 30,
      }),
    ]);

    expect(durations.get("contact-1")).toBe(125);
    expect(durations.has("contact-2")).toBe(false);
  });
});

describe("bank payment offer SPD payload storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists the payload and reads it back for the owner", () => {
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-1",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ123",
    });

    const record = readLinkyBankPaymentOfferSpdRecord({
      offerId: "offer-1",
      ownerPubkey: "owner-a",
    });
    expect(record?.spdPayload).toBe("SPD*1.0*ACC:CZ123");
    expect(record?.sentCandidateKeys).toEqual([]);
  });

  it("does not return payloads stored by a different owner", () => {
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-1",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ123",
    });

    expect(
      readLinkyBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-b",
      }),
    ).toBeNull();
  });

  it("expires stored payloads after the max age", () => {
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-1",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ123",
    });

    vi.setSystemTime(1_700_000_000_000 + 60 * 60 * 1000);
    expect(
      readLinkyBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      }),
    ).toBeNull();
    expect(
      localStorage.getItem("linky.bank_payment_offer_spd.v1.offer-1"),
    ).toBeNull();
  });

  it("tracks sent candidate keys without duplicates", () => {
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-1",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ123",
    });

    markLinkyBankPaymentOfferBankDetailsSent({
      candidateKey: "offer-1:contact-1",
      offerId: "offer-1",
    });
    markLinkyBankPaymentOfferBankDetailsSent({
      candidateKey: "offer-1:contact-1",
      offerId: "offer-1",
    });
    expect(
      readLinkyBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      })?.sentCandidateKeys,
    ).toEqual(["offer-1:contact-1"]);
  });

  it("keeps records of concurrent offers independent", () => {
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-1",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ111",
    });
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-2",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ222",
    });
    forgetLinkyBankPaymentOfferSpdPayload("offer-1");

    expect(
      readLinkyBankPaymentOfferSpdRecord({
        offerId: "offer-2",
        ownerPubkey: "owner-a",
      })?.spdPayload,
    ).toBe("SPD*1.0*ACC:CZ222");
  });

  it("prunes expired records from storage when remembering a new one", () => {
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-old",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ111",
    });

    vi.setSystemTime(1_700_000_000_000 + 60 * 60 * 1000);
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-new",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ222",
    });

    expect(
      localStorage.getItem("linky.bank_payment_offer_spd.v1.offer-old"),
    ).toBeNull();
  });

  it("forgets a stored payload", () => {
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-1",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ123",
    });

    forgetLinkyBankPaymentOfferSpdPayload("offer-1");
    expect(
      readLinkyBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      }),
    ).toBeNull();
  });

  it("survives corrupted storage content", () => {
    localStorage.setItem(
      "linky.bank_payment_offer_spd.v1.offer-1",
      "{not json",
    );
    expect(
      readLinkyBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      }),
    ).toBeNull();

    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-1",
      ownerPubkey: "owner-a",
      spdPayload: "SPD*1.0*ACC:CZ123",
    });
    expect(
      readLinkyBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      })?.spdPayload,
    ).toBe("SPD*1.0*ACC:CZ123");
  });
});

describe("bank payment offer stagger queue storage", () => {
  const createStaggerRecord = (
    overrides: Partial<LinkyBankPaymentOfferStaggerRecord> = {},
  ): LinkyBankPaymentOfferStaggerRecord => ({
    amountSat: 480,
    amountText: "480 Kč",
    createdAtSec: 1_700_000_000,
    expiresAtSec: 1_700_000_300,
    offerId: "offer-1",
    ownerPubkey: "owner-a",
    pending: [
      {
        contactId: "contact-b",
        contactPubHex: "pub-b",
        dueAtSec: 1_700_000_010,
      },
      {
        contactId: "contact-c",
        contactPubHex: "pub-c",
        dueAtSec: 1_700_000_020,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists a queue and reads it back for the owner only", () => {
    rememberLinkyBankPaymentOfferStaggerQueue(createStaggerRecord());

    expect(readLinkyBankPaymentOfferStaggerRecords("owner-a")).toEqual([
      createStaggerRecord(),
    ]);
    expect(readLinkyBankPaymentOfferStaggerRecords("owner-b")).toEqual([]);
  });

  it("deletes an expired queue on read", () => {
    rememberLinkyBankPaymentOfferStaggerQueue(createStaggerRecord());

    vi.setSystemTime(1_700_000_300_000);
    expect(readLinkyBankPaymentOfferStaggerRecords("owner-a")).toEqual([]);
    expect(
      localStorage.getItem("linky.bank_payment_offer_stagger.v1.offer-1"),
    ).toBeNull();
  });

  it("removes dequeued recipients and drops the emptied queue", () => {
    rememberLinkyBankPaymentOfferStaggerQueue(createStaggerRecord());

    removeLinkyBankPaymentOfferStaggerRecipients("offer-1", ["contact-b"]);
    expect(
      readLinkyBankPaymentOfferStaggerRecords("owner-a")[0]?.pending.map(
        (recipient) => recipient.contactId,
      ),
    ).toEqual(["contact-c"]);

    removeLinkyBankPaymentOfferStaggerRecipients("offer-1", ["contact-c"]);
    expect(
      localStorage.getItem("linky.bank_payment_offer_stagger.v1.offer-1"),
    ).toBeNull();
  });

  it("forgets a queue and survives corrupted storage content", () => {
    localStorage.setItem(
      "linky.bank_payment_offer_stagger.v1.offer-broken",
      "{not json",
    );
    rememberLinkyBankPaymentOfferStaggerQueue(createStaggerRecord());

    forgetLinkyBankPaymentOfferStaggerQueue("offer-1");
    expect(readLinkyBankPaymentOfferStaggerRecords("owner-a")).toEqual([]);
  });

  it("does not persist a queue with no pending recipients", () => {
    rememberLinkyBankPaymentOfferStaggerQueue(
      createStaggerRecord({ pending: [] }),
    );
    expect(
      localStorage.getItem("linky.bank_payment_offer_stagger.v1.offer-1"),
    ).toBeNull();
  });
});
