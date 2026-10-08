import { BankOfferId } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import type { BankPaymentOfferStaggerRecord } from "@linky-fit/proxy-payment";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetBankPaymentOfferSpdPayloads,
  forgetBankPaymentOfferStaggerQueue,
  markBankPaymentOfferBankDetailsDelivered,
  readBankPaymentOfferIdsForSpdPayload,
  readBankPaymentOfferSpdRecord,
  readBankPaymentOfferStaggerRecords,
  rememberBankPaymentOfferSpdPayload,
  reserveBankPaymentOfferBankDetails,
  rememberBankPaymentOfferStaggerQueue,
  removeBankPaymentOfferStaggerRecipients,
} from "./bankPaymentOfferStorage";

const NOW = 1_700_000_000;
const SPD = "SPD*1.0*ACC:CZ6508000000192000145399";
const offer1 = BankOfferId.make("offer-1");
const ownerA = makeIdentity().pubkey;
const ownerB = makeIdentity().pubkey;
const pubB = makeIdentity().pubkey;
const pubC = makeIdentity().pubkey;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      query: async () => ({ held: [], pending: [] }),
      request: async (_name: string, callback: () => unknown) => callback(),
    },
  });
  // fake-indexeddb schedules with setImmediate, which must stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bank payment offer SPD record storage", () => {
  const remember = (offerId = offer1, singleTabRiskAccepted = false) =>
    rememberBankPaymentOfferSpdPayload({
      offerId,
      ownerPubkey: ownerA,
      singleTabRiskAccepted,
      spdPayload: SPD,
    });
  const read = (offerId = offer1, ownerPubkey: string = ownerA) =>
    readBankPaymentOfferSpdRecord({ offerId, ownerPubkey });
  const reserve = (peer = pubB, ownerPubkey: string = ownerA) =>
    reserveBankPaymentOfferBankDetails({ offerId: offer1, ownerPubkey, peer });

  it("keeps the QR for its owner, finds offers by QR and forgets on request", async () => {
    await remember();
    expect(await read()).toMatchObject({ offerId: offer1, spdPayload: SPD });
    expect(await read(offer1, ownerB)).toBeNull();
    expect(
      await readBankPaymentOfferIdsForSpdPayload({
        ownerPubkey: ownerA,
        spdPayload: SPD,
      }),
    ).toEqual([offer1]);
    await forgetBankPaymentOfferSpdPayloads([offer1]);
    expect(await read()).toBeNull();
  });

  it("deletes a record after an hour, so a clock moving back cannot revive it", async () => {
    await remember();
    vi.setSystemTime((NOW + 3600) * 1000);
    expect(await read()).toBeNull();
    vi.setSystemTime(NOW * 1000);
    expect(await read()).toBeNull();
  });

  it("pins one payer before delivery and never replaces the pin", async () => {
    await remember();
    expect(await reserve()).toBe(true);
    expect((await read())?.pin).toEqual({ delivered: false, peer: pubB });
    expect(await reserve(pubC)).toBe(false);
    await markBankPaymentOfferBankDetailsDelivered({
      offerId: offer1,
      peer: pubC,
    });
    expect((await read())?.pin?.delivered).toBe(false);
    await markBankPaymentOfferBankDetailsDelivered({
      offerId: offer1,
      peer: pubB,
    });
    expect((await read())?.pin).toEqual({ delivered: true, peer: pubB });
    expect(await reserve()).toBe(true);
    expect(await reserve(pubB, ownerB)).toBe(false);
  });

  it("refuses a pin without a record, and keeps the pin of another offer apart", async () => {
    expect(await reserve()).toBe(false);
    await remember(BankOfferId.make("offer-2"));
    expect(await reserve()).toBe(false);
    expect((await read(BankOfferId.make("offer-2")))?.pin).toBeUndefined();
  });

  it("does not authorize delivery if the pin cannot be committed", async () => {
    await remember();
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("storage unavailable");
      },
    });
    await expect(reserve()).rejects.toThrow("storage unavailable");
  });

  it("does not authorize delivery with the single-tab lock compatibility shim", async () => {
    await remember();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, callback: () => unknown) => callback(),
      },
    });
    expect(await reserve()).toBe(false);
  });

  it("pins without cross-tab locks only after the user accepted the risk", async () => {
    await remember(offer1, true);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    expect(await reserve()).toBe(true);
    expect(await reserve(pubC)).toBe(false);
  });

  it("takes over the previous release's localStorage records with their pins", async () => {
    const legacy = (offerId: string, fields: object) =>
      localStorage.setItem(
        `linky.bank_payment_offer_spd.v1.${offerId}`,
        JSON.stringify({
          createdAtSec: NOW,
          ownerPubkey: ownerA,
          spdPayload: SPD,
          ...fields,
        }),
      );
    legacy("offer-1", {
      detailsSent: false,
      sentCandidateKeys: [`offer-1:${pubB}`],
    });
    // Before detailsSent existed, a pin was only written after delivery.
    legacy("offer-2", { sentCandidateKeys: [`offer-2:${pubC}`] });
    legacy("offer-3", { sentCandidateKeys: [] });
    legacy("offer-4", { sentCandidateKeys: ["offer-4:not-a-pubkey"] });
    localStorage.setItem(
      "linky.bank_payment_offer_spd.v1.offer-5",
      "{not json",
    );

    expect((await read())?.pin).toEqual({ delivered: false, peer: pubB });
    expect((await read(BankOfferId.make("offer-2")))?.pin).toEqual({
      delivered: true,
      peer: pubC,
    });
    expect(await read(BankOfferId.make("offer-3"))).toMatchObject({
      spdPayload: SPD,
    });
    expect(await read(BankOfferId.make("offer-4"))).toBeNull();
    expect(await read(BankOfferId.make("offer-5"))).toBeNull();
    expect(
      Object.keys(localStorage).filter((key) =>
        key.startsWith("linky.bank_payment_offer_spd"),
      ),
    ).toEqual([]);
    expect(await reserve(pubC)).toBe(false);
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
    offerId: BankOfferId.make("offer-1"),
    ownerPubkey: ownerA,
    pending: [
      { dueAtSec: NOW + 10, peer: pubB },
      { dueAtSec: NOW + 20, peer: pubC },
    ],
    ...overrides,
  });

  it("persists a queue and reads it back for the owner only", () => {
    rememberBankPaymentOfferStaggerQueue(record());
    expect(readBankPaymentOfferStaggerRecords(ownerA)).toEqual([record()]);
    expect(readBankPaymentOfferStaggerRecords(ownerB)).toEqual([]);
  });

  it("deletes an expired queue on read", () => {
    rememberBankPaymentOfferStaggerQueue(record());
    vi.setSystemTime((NOW + 300) * 1000);
    expect(readBankPaymentOfferStaggerRecords(ownerA)).toEqual([]);
    expect(
      localStorage.getItem("linky.bank_payment_offer_stagger.v1.offer-1"),
    ).toBeNull();
  });

  it("removes dequeued recipients and drops the emptied queue", () => {
    rememberBankPaymentOfferStaggerQueue(record());
    removeBankPaymentOfferStaggerRecipients(BankOfferId.make("offer-1"), [
      pubB,
    ]);
    expect(readBankPaymentOfferStaggerRecords(ownerA)[0]?.pending).toEqual([
      { dueAtSec: NOW + 20, peer: pubC },
    ]);
    removeBankPaymentOfferStaggerRecipients(BankOfferId.make("offer-1"), [
      pubC,
    ]);
    expect(readBankPaymentOfferStaggerRecords(ownerA)).toEqual([]);
  });

  it("forgets a queue, ignores empty ones and survives corrupted or outdated records", () => {
    rememberBankPaymentOfferStaggerQueue(record({ pending: [] }));
    expect(readBankPaymentOfferStaggerRecords(ownerA)).toEqual([]);
    rememberBankPaymentOfferStaggerQueue(record());
    forgetBankPaymentOfferStaggerQueue(BankOfferId.make("offer-1"));
    localStorage.setItem(
      "linky.bank_payment_offer_stagger.v1.offer-2",
      "{not json",
    );
    localStorage.setItem(
      "linky.bank_payment_offer_stagger.v1.offer-3",
      JSON.stringify({
        ...record({ offerId: BankOfferId.make("offer-3") }),
        pending: [{ contactId: "c", contactPubHex: "p", dueAtSec: NOW + 1 }],
      }),
    );
    expect(readBankPaymentOfferStaggerRecords(ownerA)).toEqual([]);
    expect(
      localStorage.getItem("linky.bank_payment_offer_stagger.v1.offer-3"),
    ).toBeNull();
  });
});
