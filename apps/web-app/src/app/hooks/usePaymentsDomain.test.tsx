import { encodeNpub } from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { LocalPendingPayment } from "../types/appTypes";
import { usePaymentsDomain } from "./usePaymentsDomain";

const approved = makeIdentity();
const changed = makeIdentity();
const contact = { id: "contact-1", npub: encodeNpub(approved.pubkey) };
const pending: LocalPendingPayment = {
  id: "pending-1",
  amountSat: 600,
  contactId: contact.id,
  recipientPubkey: approved.pubkey,
  createdAtSec: 1,
  messageId: "placeholder-1",
};
type Params = Parameters<typeof usePaymentsDomain<typeof contact>>[0];
const cleanups: (() => Promise<void>)[] = [];

const setup = async (
  entry: LocalPendingPayment = pending,
  initialContact = contact,
) => {
  let online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const pay = vi.fn<Params["payContactWithCashuMessage"]>(async () => ({
    ok: true,
    queued: false,
  }));
  const remove = vi.fn();
  const update = vi.fn<Params["updateLocalNostrMessage"]>();
  const toast = vi.fn();
  const Harness = ({
    recipient,
    queued,
  }: {
    recipient: typeof contact;
    queued: LocalPendingPayment;
  }) => {
    usePaymentsDomain({
      cashuIsBusy: false,
      contacts: [recipient],
      currentNpub: "self",
      currentNsec: "self-test-fixture",
      payContactWithCashuMessage: pay,
      pendingPayments: [queued],
      pushToast: toast,
      removePendingPayment: remove,
      updateLocalNostrMessage: update,
      setCashuIsBusy: vi.fn(),
      t: (key) => key,
    });
    return null;
  };
  const mounted = await renderIntoDocument(
    <Harness recipient={initialContact} queued={entry} />,
  );
  cleanups.push(mounted.unmount);
  return {
    pay,
    remove,
    update,
    toast,
    rerender: (
      recipient: typeof contact,
      queued: LocalPendingPayment = entry,
    ) => mounted.rerender(<Harness recipient={recipient} queued={queued} />),
    flush: () =>
      act(async () => {
        online = true;
        window.dispatchEvent(new Event("online"));
      }),
  };
};

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

describe("queued payment authorization", () => {
  it("flushes the pinned amount to the approved identity", async () => {
    const harness = await setup();
    await harness.flush();
    expect(harness.pay).toHaveBeenCalledOnce();
    expect(harness.pay).toHaveBeenCalledWith(
      expect.objectContaining({
        amountSat: 600,
        contact,
        fromQueue: true,
        pendingMessageId: pending.messageId,
      }),
    );
    expect(harness.pay.mock.calls[0]?.[0].isPaymentAuthorized?.()).toBe(true);
    expect(harness.remove).toHaveBeenCalledWith(pending.id);
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it("cancels a changed identity without attempting payment", async () => {
    const harness = await setup(pending, {
      ...contact,
      npub: encodeNpub(changed.pubkey),
    });
    await harness.flush();
    expect(harness.pay).not.toHaveBeenCalled();
    expect(harness.remove).toHaveBeenCalledWith(pending.id);
    expect(harness.update).toHaveBeenCalledWith(pending.messageId, {
      content: "payApprovalChanged",
      status: "sent",
      localOnly: true,
    });
    expect(harness.toast).toHaveBeenCalledWith("payApprovalChanged");
  });

  it("cancels legacy approvals without silently binding the current contact identity", async () => {
    const legacy = { ...pending };
    delete legacy.recipientPubkey;
    const harness = await setup(legacy);
    await harness.flush();
    expect(harness.pay).not.toHaveBeenCalled();
    expect(harness.remove).toHaveBeenCalledWith(pending.id);
    expect(harness.update).toHaveBeenCalledWith(
      pending.messageId,
      expect.objectContaining({
        status: "sent",
        content: "payApprovalChanged",
      }),
    );
  });

  it("can flush a new approval after canceling a legacy entry", async () => {
    const legacy = { ...pending };
    delete legacy.recipientPubkey;
    const harness = await setup(legacy);
    await harness.flush();
    expect(harness.pay).not.toHaveBeenCalled();
    await harness.rerender(contact, { ...pending, id: "new-approval" });
    expect(harness.pay).toHaveBeenCalledOnce();
    expect(harness.remove).toHaveBeenCalledWith("new-approval");
  });

  it("invalidates an in-flight approval when the contact changes while preserving its frozen payment arguments", async () => {
    const harness = await setup();
    let finish: (() => void) | undefined;
    harness.pay.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { ok: false, queued: false };
    });
    await harness.flush();
    const args = harness.pay.mock.calls[0]?.[0];
    expect(args?.isPaymentAuthorized?.()).toBe(true);
    await harness.rerender({ ...contact, npub: encodeNpub(changed.pubkey) });
    expect(args?.isPaymentAuthorized?.()).toBe(false);
    expect(args?.contact.npub).toBe(contact.npub);
    expect(args?.amountSat).toBe(600);
    await act(async () => {
      finish?.();
    });
  });
});
