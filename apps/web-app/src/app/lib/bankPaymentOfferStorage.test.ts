import type { BankPaymentOfferStaggerRecord } from "@linky/proxy-payment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetBankPaymentOfferSpdPayload,
  forgetBankPaymentOfferStaggerQueue,
  markBankPaymentOfferBankDetailsSent,
  readBankPaymentOfferSpdRecord,
  readBankPaymentOfferStaggerRecords,
  rememberBankPaymentOfferSpdPayload,
  rememberBankPaymentOfferStaggerQueue,
  removeBankPaymentOfferStaggerRecipients,
} from "./bankPaymentOfferStorage";

const NOW = 1_700_000_000;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bank payment offer SPD payload storage", () => {
  const remember = (offerId = "offer-1", ownerPubkey = "owner-a") =>
    rememberBankPaymentOfferSpdPayload({
      offerId,
      ownerPubkey,
      spdPayload: "SPD*1.0*ACC:CZ6508000000192000145399",
    });

  it("persists the payload for its owner only and forgets it on request", () => {
    remember();
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      }),
    ).toMatchObject({
      sentCandidateKeys: [],
      spdPayload: expect.stringMatching(/^SPD/),
    });
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-b",
      }),
    ).toBeNull();
    forgetBankPaymentOfferSpdPayload("offer-1");
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      }),
    ).toBeNull();
  });

  it("expires stored payloads after an hour and prunes them when remembering a new one", () => {
    remember("offer-old");
    vi.setSystemTime((NOW + 3600) * 1000);
    remember("offer-new");
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-old",
        ownerPubkey: "owner-a",
      }),
    ).toBeNull();
    expect(
      localStorage.getItem("linky.bank_payment_offer_spd.v1.offer-old"),
    ).toBeNull();
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-new",
        ownerPubkey: "owner-a",
      }),
    ).not.toBeNull();
  });

  it("tracks sent candidate keys without duplicates and keeps offers independent", () => {
    remember("offer-1");
    remember("offer-2");
    markBankPaymentOfferBankDetailsSent({
      candidateKey: "offer-1:peer",
      offerId: "offer-1",
    });
    markBankPaymentOfferBankDetailsSent({
      candidateKey: "offer-1:peer",
      offerId: "offer-1",
    });
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      })?.sentCandidateKeys,
    ).toEqual(["offer-1:peer"]);
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-2",
        ownerPubkey: "owner-a",
      })?.sentCandidateKeys,
    ).toEqual([]);
  });

  it("survives corrupted storage content", () => {
    localStorage.setItem(
      "linky.bank_payment_offer_spd.v1.offer-1",
      "{not json",
    );
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: "owner-a",
      }),
    ).toBeNull();
  });
});

describe("bank payment offer stagger queue storage", () => {
  const record = (
    overrides: Partial<BankPaymentOfferStaggerRecord> = {},
  ): BankPaymentOfferStaggerRecord => ({
    amountSat: 480,
    amountText: "480 Kč",
    createdAtSec: NOW,
    expiresAtSec: NOW + 300,
    offerId: "offer-1",
    ownerPubkey: "owner-a",
    pending: [
      { dueAtSec: NOW + 10, peer: "pub-b" },
      { dueAtSec: NOW + 20, peer: "pub-c" },
    ],
    ...overrides,
  });

  it("persists a queue and reads it back for the owner only", () => {
    rememberBankPaymentOfferStaggerQueue(record());
    expect(readBankPaymentOfferStaggerRecords("owner-a")).toEqual([record()]);
    expect(readBankPaymentOfferStaggerRecords("owner-b")).toEqual([]);
  });

  it("deletes an expired queue on read", () => {
    rememberBankPaymentOfferStaggerQueue(record());
    vi.setSystemTime((NOW + 300) * 1000);
    expect(readBankPaymentOfferStaggerRecords("owner-a")).toEqual([]);
    expect(
      localStorage.getItem("linky.bank_payment_offer_stagger.v1.offer-1"),
    ).toBeNull();
  });

  it("removes dequeued recipients and drops the emptied queue", () => {
    rememberBankPaymentOfferStaggerQueue(record());
    removeBankPaymentOfferStaggerRecipients("offer-1", ["pub-b"]);
    expect(readBankPaymentOfferStaggerRecords("owner-a")[0]?.pending).toEqual([
      { dueAtSec: NOW + 20, peer: "pub-c" },
    ]);
    removeBankPaymentOfferStaggerRecipients("offer-1", ["pub-c"]);
    expect(readBankPaymentOfferStaggerRecords("owner-a")).toEqual([]);
  });

  it("forgets a queue, ignores empty ones and survives corrupted or outdated records", () => {
    rememberBankPaymentOfferStaggerQueue(record({ pending: [] }));
    expect(readBankPaymentOfferStaggerRecords("owner-a")).toEqual([]);
    rememberBankPaymentOfferStaggerQueue(record());
    forgetBankPaymentOfferStaggerQueue("offer-1");
    localStorage.setItem(
      "linky.bank_payment_offer_stagger.v1.offer-2",
      "{not json",
    );
    localStorage.setItem(
      "linky.bank_payment_offer_stagger.v1.offer-3",
      JSON.stringify({
        ...record({ offerId: "offer-3" }),
        pending: [{ contactId: "c", contactPubHex: "p", dueAtSec: NOW + 1 }],
      }),
    );
    expect(readBankPaymentOfferStaggerRecords("owner-a")).toEqual([]);
    expect(
      localStorage.getItem("linky.bank_payment_offer_stagger.v1.offer-3"),
    ).toBeNull();
  });
});
