import type { BankOfferStatus } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import { createLinkyBankPaymentOfferEvent } from "../../testUtils/bankPaymentOfferEvent";
import type { LocalNostrMessage } from "../types/appTypes";
import { bankPaymentOfferToOpen } from "./bankPaymentOfferRows";

const offerer = makeIdentity().pubkey;
const payer = makeIdentity().pubkey;
const NOW = 1_800_000_000;
const CHAT = "contact-offerer";

/** The payer's row of one offer thread, last updated at `updatedAtSec`. */
const row = (
  offerId: string,
  status: BankOfferStatus,
  {
    amountText = "250 Kč",
    direction = "in",
    initiatedAtSec = NOW - 60,
    updatedAtSec = initiatedAtSec,
  }: {
    amountText?: string;
    direction?: "in" | "out";
    initiatedAtSec?: number;
    updatedAtSec?: number;
  } = {},
): LocalNostrMessage => ({
  contactId: CHAT,
  content: createLinkyBankPaymentOfferEvent({
    amountSat: 1_000,
    amountText,
    clientId: `${offerId}-${status}`,
    createdAt: updatedAtSec,
    initiatedAtSec,
    offerId,
    offererPublicKey: offerer,
    recipientPublicKey: payer,
    senderPublicKey: offerer,
    status,
  }).content,
  createdAtSec: initiatedAtSec,
  direction,
  id: `bank-payment-offer:${CHAT}:${offerId}`,
  pubkey: offerer,
  rumorId: null,
  wrapId: offerId,
});

const open = (
  rows: LocalNostrMessage[],
  minimized: readonly string[] = [],
): string | null =>
  bankPaymentOfferToOpen(rows, CHAT, NOW, (offerId) =>
    minimized.includes(offerId),
  );

describe("bankPaymentOfferToOpen", () => {
  it("opens the newest live offer waiting for an answer", () => {
    expect(
      open(
        [
          row("older", "offered", { amountText: "300 Kč" }),
          row("newer", "offered", { initiatedAtSec: NOW - 30 }),
          row("expired", "offered", { initiatedAtSec: NOW - 600 }),
          row("mine", "offered", { direction: "out", initiatedAtSec: NOW - 1 }),
          row("hidden", "offered", { initiatedAtSec: NOW - 2 }),
        ],
        ["hidden"],
      ),
    ).toBe("newer");
  });

  it.each<[string, BankOfferStatus, number]>([
    ["lost", "accepted_by_other", NOW - 10],
    ["is still answering", "accepted", NOW - 120],
    ["declined", "declined", NOW - 10],
  ])(
    "leaves an offer of the same payment closed when the payer %s another one running beside it",
    (_case, status, updatedAtSec) => {
      const rows = [
        row("first", status, { initiatedAtSec: NOW - 120, updatedAtSec }),
        row("second", "offered"),
      ];
      expect(open(rows)).toBeNull();
    },
  );

  it("opens an offer of the same payment made after the earlier one ended", () => {
    const rows = [
      row("first", "settled", {
        initiatedAtSec: NOW - 3_600,
        updatedAtSec: NOW - 3_000,
      }),
      row("second", "offered"),
    ];
    expect(open(rows)).toBe("second");
  });

  it("opens an offer of a different amount beside a lost one", () => {
    const rows = [
      row("first", "accepted_by_other", {
        initiatedAtSec: NOW - 120,
        updatedAtSec: NOW - 10,
      }),
      row("second", "offered", { amountText: "300 Kč" }),
    ];
    expect(open(rows)).toBe("second");
  });
});
