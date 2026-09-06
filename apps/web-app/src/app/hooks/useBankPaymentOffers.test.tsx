import {
  BankOfferDraft,
  BankOfferReceipt,
  ClientId,
  encodeNpub,
  RumorId,
  UnixSeconds,
  WrapDelivery,
  WrapId,
} from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { Exit } from "effect";
import { nip19 } from "nostr-tools";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkyBankPaymentOfferEvent } from "../../testUtils/bankPaymentOfferEvent";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import {
  getLinkyBankPaymentOfferInfo,
  readLinkyBankPaymentOfferSpdRecord,
  readLinkyBankPaymentOfferStaggerRecords,
  rememberLinkyBankPaymentOfferSpdPayload,
  rememberLinkyBankPaymentOfferStaggerQueue,
  type LinkyBankPaymentOfferStatus,
} from "../lib/bankPaymentOffer";
import type { LocalNostrMessage } from "../types/appTypes";

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
const NOW = 1_730_000_000;
const SPD = "SPD*1.0*ACC:CZ6508000000192000145399*AM:250*CC:CZK";

const message = (
  contactId: string,
  status: LinkyBankPaymentOfferStatus = "offered",
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
  pubkey: recipient.pubkey,
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
    rumorId: RumorId.make("22".repeat(32)),
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
    contacts: [],
    currentNpub: null,
    currentNsec: null,
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

const signedIn = {
  currentNpub: encodeNpub(owner.pubkey),
  currentNsec: nip19.nsecEncode(owner.secretKey),
};

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

  it("keeps recipient rows separate and retains the latest status when old snapshots replay", async () => {
    const current = await setup();
    await act(async () => {
      current().upsertBankPaymentOfferMessage(message("contact-1"));
      current().upsertBankPaymentOfferMessage(message("contact-2"));
      current().upsertBankPaymentOfferMessage(
        message("contact-1", "bank_paid", NOW + 10),
      );
      current().upsertBankPaymentOfferMessage(
        message("contact-1", "accepted", NOW + 5),
      );
    });

    const rows = current().bankPaymentOfferMessages;
    expect(rows).toHaveLength(2);
    const first = rows.find((row) => row.contactId === "contact-1");
    expect(first).toMatchObject({
      id: "bank-payment-offer:contact-1:offer-1",
      createdAtSec: NOW,
      direction: "out",
    });
    expect(getLinkyBankPaymentOfferInfo(first?.content ?? "")?.status).toBe(
      "bank_paid",
    );
    expect(current().chatMessagesWithBankPaymentOffers).toEqual([first]);
  });

  it("uses status rank to resolve snapshots with the same timestamp", async () => {
    const current = await setup();
    await act(async () => {
      current().upsertBankPaymentOfferMessage(message("contact-1", "settled"));
      current().upsertBankPaymentOfferMessage(message("contact-1", "offered"));
    });
    expect(current().bankPaymentOfferMessages).toHaveLength(1);
    expect(
      getLinkyBankPaymentOfferInfo(
        current().bankPaymentOfferMessages[0]?.content ?? "",
      )?.status,
    ).toBe("settled");
  });

  it("deduplicates persisted chat rows against offer snapshots and reassigns unknown contacts", async () => {
    const persisted = message("contact-1");
    const current = await setup({ chatMessages: [persisted] });
    await act(async () => {
      current().upsertBankPaymentOfferMessage(
        message("contact-1", "accepted", NOW + 1),
      );
      current().upsertBankPaymentOfferMessage(message("unknown:peer"));
    });
    expect(current().chatMessagesWithBankPaymentOffers).toEqual([persisted]);
    await act(async () => {
      current().reassignBankPaymentOfferMessages("unknown:peer", "contact-2");
    });
    expect(
      current().bankPaymentOfferMessages.map((row) => row.contactId),
    ).toEqual(["contact-2", "contact-1"]);
  });

  it.each(["wrapId", "clientId", "id"])(
    "deduplicates non-offer rows by %s without treating blank keys as identities",
    async (key) => {
      const current = await setup();
      const first = { ...message("contact-1"), content: "plain", wrapId: "" };
      const second = { ...first, id: "second" };
      await act(async () => {
        current().upsertBankPaymentOfferMessage({ ...first, [key]: "shared" });
        current().upsertBankPaymentOfferMessage({ ...second, [key]: "shared" });
        current().upsertBankPaymentOfferMessage({ ...second, id: "distinct" });
      });
      expect(current().bankPaymentOfferMessages).toHaveLength(2);
    },
  );

  it("sends the first recipient and persists the remaining staggered recipients", async () => {
    const current = await setup(signedIn);
    await act(async () => {
      const requested = await current().requestBankPaymentOffer({
        amountSat: 100,
        amountText: "250 Kč",
        contacts: [
          { id: "contact-1", npub: encodeNpub(recipient.pubkey) },
          { id: "contact-2", npub: encodeNpub(makeIdentity().pubkey) },
        ],
        spdPayload: SPD,
        staggerDelaySec: 10,
      });
      expect(requested?.chatId).toBe("contact-1");
    });
    expect(sendBankOfferMock).toHaveBeenCalledTimes(1);
    const [queued] = readLinkyBankPaymentOfferStaggerRecords(owner.pubkey);
    expect(queued).toMatchObject({
      expiresAtSec: NOW + 300,
      pending: [{ contactId: "contact-2", dueAtSec: NOW + 10 }],
    });
    expect(current().bankPaymentOfferRecipientCount).toBe(2);
    expect(current().bankPaymentOfferStaggerDelaySec).toBe(10);
  });

  it("dispatches a restored stagger queue at its due time with the original expiry", async () => {
    rememberLinkyBankPaymentOfferStaggerQueue({
      amountSat: 100,
      amountText: "250 Kč",
      createdAtSec: NOW,
      expiresAtSec: NOW + 300,
      offerId: "offer-1",
      ownerPubkey: owner.pubkey,
      pending: [
        {
          contactId: "contact-1",
          contactPubHex: recipient.pubkey,
          dueAtSec: NOW + 10,
        },
      ],
    });
    const current = await setup(signedIn);
    expect(sendBankOfferMock).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(sendBankOfferMock).toHaveBeenCalledTimes(1);
    expect(sendBankOfferMock.mock.calls[0]?.[0]).toMatchObject({
      status: "offered",
      to: recipient.pubkey,
      expiresAtSec: NOW + 300,
    });
    expect(readLinkyBankPaymentOfferStaggerRecords(owner.pubkey)).toEqual([]);
    expect(current().bankPaymentOfferMessages).toHaveLength(1);
  });

  it("sends bank details once after a pending acceptance and records the winning recipient", async () => {
    rememberLinkyBankPaymentOfferSpdPayload({
      offerId: "offer-1",
      ownerPubkey: owner.pubkey,
      spdPayload: SPD,
    });
    const current = await setup(signedIn);
    await act(async () => {
      current().upsertBankPaymentOfferMessage(message("contact-1", "accepted"));
    });
    expect(sendBankOfferMock).toHaveBeenCalledTimes(1);
    expect(sendBankOfferMock.mock.calls[0]?.[0]).toMatchObject({
      status: "bank_details_sent",
      spdPayload: SPD,
      to: recipient.pubkey,
    });
    expect(
      readLinkyBankPaymentOfferSpdRecord({
        offerId: "offer-1",
        ownerPubkey: owner.pubkey,
      })?.sentCandidateKeys,
    ).toEqual(["offer-1:contact-1"]);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(sendBankOfferMock).toHaveBeenCalledTimes(1);
  });

  it("cancels an owned offer when its phase expires", async () => {
    const current = await setup(signedIn);
    await act(async () => {
      current().upsertBankPaymentOfferMessage(message("contact-1"));
    });
    await act(async () => vi.advanceTimersByTimeAsync(299_000));
    expect(sendBankOfferMock).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(sendBankOfferMock).toHaveBeenCalledTimes(1);
    expect(sendBankOfferMock.mock.calls[0]?.[0]).toMatchObject({
      status: "canceled",
    });
    expect(current().isBankPaymentOfferCanceled("offer-1")).toBe(true);
  });
});
