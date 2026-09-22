import {
  BankOfferId,
  BankOfferReceipt,
  BankOfferSnapshotReceived,
  ClientId,
  encodeNpub,
  OwnBankOfferSnapshotConfirmed,
  Pubkey,
  RumorId,
  UnixSeconds,
  WrapDelivery,
  WrapId,
  type BankOfferDraft,
  type BankOfferInboxEvent,
  type BankOfferStatus,
} from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { decodeBankPaymentOffer } from "@linky/proxy-payment";
import { Exit } from "effect";
import { nip19 } from "nostr-tools";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkyBankPaymentOfferEvent } from "../../testUtils/bankPaymentOfferEvent";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import {
  readBankPaymentOfferSpdRecord,
  readBankPaymentOfferStaggerRecords,
  rememberBankPaymentOfferSpdPayload,
  rememberBankPaymentOfferStaggerQueue,
} from "../lib/bankPaymentOfferStorage";
import type { ContactRowLike, LocalNostrMessage } from "../types/appTypes";

type SendBankOffer = (
  draft: BankOfferDraft,
) => Promise<Exit.Exit<BankOfferReceipt, Error>>;

const { sendBankOfferMock } = vi.hoisted(() => ({
  sendBankOfferMock: vi.fn<SendBankOffer>(),
}));
vi.mock("@linky/linkstr-react", () => ({
  sendBankOfferAtom: "sendBankOfferAtom",
  useAtomSet: () => sendBankOfferMock,
}));

import { useBankPaymentOffers } from "./useBankPaymentOffers";

const owner = makeIdentity();
const recipient = makeIdentity();
const second = makeIdentity();
const NOW = 1_730_000_000;
const SPD = "SPD*1.0*ACC:CZ6508000000192000145399*AM:250*CC:CZK";
const contacts: ContactRowLike[] = [
  { id: "contact-1", npub: encodeNpub(recipient.pubkey) },
  { id: "contact-2", npub: encodeNpub(second.pubkey) },
];

let sequence = 0;
const rumorId = () => RumorId.make((++sequence).toString(16).padStart(64, "0"));

/** A snapshot of `offer-1` offered by `owner`; a payer status is authored by the peer. */
const snapshot = (
  status: BankOfferStatus,
  peer: Pubkey = recipient.pubkey,
  sentAt = NOW,
): BankOfferInboxEvent => {
  const fields = {
    snapshotId: rumorId(),
    offerId: BankOfferId.make("offer-1"),
    offerer: owner.pubkey,
    status,
    amountText: "250 Kč",
    text: null,
    amountSat: 100,
    initiatedAtSec: UnixSeconds.make(NOW),
    bankPaidAtSec: null,
    expiresAtSec: null,
    extensionSec: null,
    spdPayload: null,
    statusUpdatedAtSec: UnixSeconds.make(sentAt),
    clientId: null,
    sentAt: UnixSeconds.make(sentAt),
  };
  return status === "offered" ||
    status === "bank_details_sent" ||
    status === "accepted_by_other" ||
    status === "canceled" ||
    status === "settled"
    ? new OwnBankOfferSnapshotConfirmed({ ...fields, to: peer })
    : new BankOfferSnapshotReceived({ ...fields, from: peer });
};

const persistedRow = (
  contactId: string,
  status: BankOfferStatus,
  createdAtSec = NOW,
): LocalNostrMessage => ({
  contactId,
  content: createLinkyBankPaymentOfferEvent({
    amountText: "250 Kč",
    clientId: `${contactId}-${status}`,
    createdAt: createdAtSec,
    offerId: "offer-1",
    offererPublicKey: owner.pubkey,
    recipientPublicKey: recipient.pubkey,
    senderPublicKey: owner.pubkey,
    status,
  }).content,
  createdAtSec,
  direction: "out",
  id: `${contactId}-${status}`,
  pubkey: owner.pubkey,
  rumorId: null,
  wrapId: `wrap-${contactId}-${status}`,
});

const receipt = (draft: BankOfferDraft): BankOfferReceipt => {
  const sentAt = UnixSeconds.make(Math.floor(Date.now() / 1000));
  const clientId = draft.clientId ?? ClientId.make("sent-client");
  return new BankOfferReceipt({
    clientId,
    content: createLinkyBankPaymentOfferEvent({
      amountText: draft.amountText,
      amountSat: draft.amountSat ?? null,
      clientId,
      createdAt: sentAt,
      expiresAtSec: draft.expiresAtSec ?? null,
      initiatedAtSec: draft.initiatedAtSec ?? null,
      offerId: draft.offerId,
      offererPublicKey: draft.offerer,
      recipientPublicKey: draft.to,
      senderPublicKey: owner.pubkey,
      spdPayload: draft.spdPayload ?? null,
      status: draft.status,
    }).content,
    offerId: draft.offerId,
    recipientCopy: new WrapDelivery({
      acceptedBy: [],
      rejectedBy: [],
      wrapId: WrapId.make("11".repeat(32)),
    }),
    rumorId: rumorId(),
    selfCopy: new WrapDelivery({
      acceptedBy: [],
      rejectedBy: [],
      wrapId: WrapId.make("33".repeat(32)),
    }),
    sentAt,
    status: draft.status,
  });
};

const unmounts: (() => Promise<void>)[] = [];
const setup = async (
  overrides: Partial<Parameters<typeof useBankPaymentOffers>[0]> = {},
) => {
  let value: ReturnType<typeof useBankPaymentOffers> | undefined;
  const params: Parameters<typeof useBankPaymentOffers>[0] = {
    chatMessages: [],
    contacts,
    currentNsec: nip19.nsecEncode(owner.secretKey),
    route: { kind: "chat", id: "contact-1" },
    setStatus: vi.fn(),
    t: (key) => key,
    ...overrides,
  };
  const Harness = () => {
    const offers = useBankPaymentOffers(params);
    useEffect(() => {
      value = offers;
    }, [offers]);
    return null;
  };
  const mounted = await renderIntoDocument(<Harness />);
  unmounts.push(mounted.unmount);
  return () => {
    if (!value) throw new Error("hook did not render");
    return value;
  };
};

const statusOf = (row: LocalNostrMessage | undefined) =>
  decodeBankPaymentOffer(row?.content ?? "")?.status;

describe("useBankPaymentOffers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    window.localStorage.clear();
    sendBankOfferMock.mockImplementation(async (draft) =>
      Exit.succeed(receipt(draft)),
    );
  });

  afterEach(async () => {
    for (const unmount of unmounts.splice(0)) await unmount();
    vi.useRealTimers();
    sendBankOfferMock.mockReset();
    window.localStorage.clear();
  });

  it("does not authorize persisted chat snapshots after reload or act on them", async () => {
    const forged = persistedRow("contact-1", "bank_paid");
    const current = await setup({ chatMessages: [forged] });
    expect(current().bankPaymentOfferMessages).toEqual([]);
    expect(current().getBankPaymentOfferForSettlement(forged)).toBeNull();
    await act(async () => {
      expect(
        await current().respondToBankPaymentOfferWithGroupState(
          forged,
          "settled",
        ),
      ).toBe(false);
      expect(
        await current().respondToBankPaymentOfferWithGroupState(
          forged,
          "bank_details_sent",
        ),
      ).toBe(false);
    });
    expect(sendBankOfferMock).not.toHaveBeenCalled();
  });

  it("settles only the current authenticated thread of the signed-in offerer", async () => {
    const current = await setup();
    await act(async () => {
      current().applyBankPaymentOfferSnapshot(snapshot("offered"));
      current().applyBankPaymentOfferSnapshot(snapshot("accepted"));
      current().applyBankPaymentOfferSnapshot(snapshot("bank_details_sent"));
      current().applyBankPaymentOfferSnapshot(snapshot("bank_paid"));
    });
    // The responder closes nothing here: the winner already has the details.
    const [paid] = current().bankPaymentOfferMessages;
    if (!paid) throw new Error("missing paid offer");
    expect(current().getBankPaymentOfferForSettlement(paid)).toMatchObject({
      peer: recipient.pubkey,
      status: "bank_paid",
    });
    // The row's content is never trusted; the thread is looked up by contact and offer.
    expect(
      current().getBankPaymentOfferForSettlement({
        ...paid,
        content: paid.content.replace("250", "25000"),
      })?.amountText,
    ).toBe("250 Kč");
    expect(
      current().getBankPaymentOfferForSettlement({
        ...paid,
        contactId: "contact-2",
      }),
    ).toBeNull();
    await act(async () => {
      current().applyBankPaymentOfferSnapshot(
        snapshot("canceled", recipient.pubkey, NOW + 1),
      );
    });
    expect(current().getBankPaymentOfferForSettlement(paid)).toBeNull();
    expect(
      current().isBankPaymentOfferCanceled(BankOfferId.make("offer-1")),
    ).toBe(true);
  });

  it("keeps one row per recipient with the latest status and dedupes persisted chat rows", async () => {
    const persisted = persistedRow("contact-1", "offered");
    const current = await setup({ chatMessages: [persisted] });
    await act(async () => {
      current().applyBankPaymentOfferSnapshot(snapshot("offered"));
      current().applyBankPaymentOfferSnapshot(
        snapshot("offered", second.pubkey),
      );
      current().applyBankPaymentOfferSnapshot(
        snapshot("accepted", recipient.pubkey, NOW + 5),
      );
      // The responder sends bank details to the acceptance; a stale replay changes nothing.
      current().applyBankPaymentOfferSnapshot(
        snapshot("accepted", recipient.pubkey, NOW + 5),
      );
    });
    const rows = current().bankPaymentOfferMessages;
    expect(rows.map((row) => row.contactId)).toEqual([
      "contact-1",
      "contact-2",
    ]);
    expect(rows[0]).toMatchObject({
      createdAtSec: NOW,
      direction: "out",
      id: "bank-payment-offer:contact-1:offer-1",
    });
    expect(current().chatMessagesWithBankPaymentOffers).toEqual([persisted]);
  });

  it("moves an unknown peer's offer to the contact once it is saved", async () => {
    const current = await setup({ contacts: [] });
    await act(async () => {
      current().applyBankPaymentOfferSnapshot(snapshot("offered"));
    });
    expect(current().bankPaymentOfferMessages[0]?.contactId).toBe(
      `unknown:${recipient.pubkey}`,
    );
    const saved = await setup();
    await act(async () => {
      saved().applyBankPaymentOfferSnapshot(snapshot("offered"));
    });
    expect(saved().bankPaymentOfferMessages[0]?.contactId).toBe("contact-1");
    expect([...saved().activeBankPaymentOfferContacts(NOW).contactIds]).toEqual(
      ["contact-1"],
    );
  });

  it("sends the first recipient and persists the remaining staggered recipients", async () => {
    const current = await setup();
    await act(async () => {
      const requested = await current().requestBankPaymentOffer({
        amountSat: 100,
        amountText: "250 Kč",
        contacts,
        spdPayload: SPD,
        staggerDelaySec: 10,
      });
      expect(requested?.chatId).toBe("contact-1");
    });
    expect(sendBankOfferMock).toHaveBeenCalledTimes(1);
    const [queued] = readBankPaymentOfferStaggerRecords(owner.pubkey);
    expect(queued).toMatchObject({
      expiresAtSec: NOW + 300,
      pending: [{ dueAtSec: NOW + 10, peer: second.pubkey }],
    });
    expect(current().bankPaymentOfferRecipientCount).toBe(2);
    expect(current().bankPaymentOfferStaggerDelaySec).toBe(10);
    expect(current().bankPaymentOfferMessages).toHaveLength(1);
  });

  it("dispatches a restored stagger queue at its due time with the original expiry", async () => {
    rememberBankPaymentOfferStaggerQueue({
      amountSat: 100,
      amountText: "250 Kč",
      createdAtSec: NOW,
      expiresAtSec: NOW + 300,
      offerId: BankOfferId.make("offer-1"),
      ownerPubkey: owner.pubkey,
      pending: [{ dueAtSec: NOW + 10, peer: recipient.pubkey }],
    });
    const current = await setup();
    expect(sendBankOfferMock).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(sendBankOfferMock).toHaveBeenCalledTimes(1);
    expect(sendBankOfferMock.mock.calls[0]?.[0]).toMatchObject({
      expiresAtSec: NOW + 300,
      status: "offered",
      to: recipient.pubkey,
    });
    expect(readBankPaymentOfferStaggerRecords(owner.pubkey)).toEqual([]);
    expect(current().bankPaymentOfferMessages).toHaveLength(1);
  });

  it("sends bank details once after an acceptance and tells the other recipient", async () => {
    rememberBankPaymentOfferSpdPayload({
      offerId: BankOfferId.make("offer-1"),
      ownerPubkey: owner.pubkey,
      spdPayload: SPD,
    });
    const current = await setup();
    await act(async () => {
      current().applyBankPaymentOfferSnapshot(snapshot("offered"));
      current().applyBankPaymentOfferSnapshot(
        snapshot("offered", second.pubkey),
      );
      current().applyBankPaymentOfferSnapshot(snapshot("accepted"));
    });
    const statuses = sendBankOfferMock.mock.calls.map(([draft]) => [
      draft.status,
      draft.to,
    ]);
    expect(statuses).toEqual([
      ["bank_details_sent", recipient.pubkey],
      ["accepted_by_other", second.pubkey],
    ]);
    expect(sendBankOfferMock.mock.calls[0]?.[0].spdPayload).toBe(SPD);
    expect(
      readBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: owner.pubkey,
      })?.sentCandidateKeys,
    ).toEqual([`offer-1:${recipient.pubkey}`]);
    expect(current().bankPaymentOfferMessages.map(statusOf)).toEqual([
      "bank_details_sent",
      "accepted_by_other",
    ]);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(sendBankOfferMock).toHaveBeenCalledTimes(2);
  });

  it("cancels an owned offer when its phase expires", async () => {
    const current = await setup();
    await act(async () => {
      current().applyBankPaymentOfferSnapshot(snapshot("offered"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(299_000));
    expect(sendBankOfferMock).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(sendBankOfferMock).toHaveBeenCalledTimes(1);
    expect(sendBankOfferMock.mock.calls[0]?.[0]).toMatchObject({
      status: "canceled",
    });
    expect(
      current().isBankPaymentOfferCanceled(BankOfferId.make("offer-1")),
    ).toBe(true);
  });

  it("responds from a chat row by looking the thread up, never from the row's content", async () => {
    const current = await setup();
    await act(async () => {
      current().applyBankPaymentOfferSnapshot(snapshot("offered"));
    });
    const [row] = current().bankPaymentOfferMessages;
    if (!row) throw new Error("missing row");
    await act(async () => {
      expect(
        await current().respondToBankPaymentOfferWithGroupState(
          { ...row, content: row.content.replace("250", "25000") },
          "canceled",
        ),
      ).toBe(true);
    });
    expect(sendBankOfferMock.mock.calls[0]?.[0]).toMatchObject({
      amountText: "250 Kč",
      status: "canceled",
      to: recipient.pubkey,
    });
    expect(statusOf(current().bankPaymentOfferMessages[0])).toBe("canceled");
  });
});
