import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import {
  appendStoredPendingPayment,
  claimStoredPendingPayment,
  readPendingPayments,
} from "../lib/pendingPayments";
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
const key = "linky.test.pending-payments";
type Params = Parameters<typeof usePaymentsDomain<typeof contact>>[0];
type PayResult = Awaited<ReturnType<Params["payContactWithCashuMessage"]>>;
const cleanups: (() => Promise<void>)[] = [];
let online = false;

const installCrossTabLocks = () => {
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      query: async () => ({ held: [], pending: [] }),
      request: async (
        name: string,
        _options: LockOptions,
        callback: (lock: Lock | null) => Promise<void> | undefined,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ mode: "exclusive", name });
        } finally {
          held.delete(name);
        }
      },
    },
  });
};

const storedIds = () => readPendingPayments(key).map((entry) => entry.id);

const setup = async ({
  entry = pending,
  initialContact = contact,
  pay = vi.fn<Params["payContactWithCashuMessage"]>(async () => ({
    ok: true,
    queued: false,
  })),
}: {
  entry?: LocalPendingPayment;
  initialContact?: typeof contact;
  pay?: ReturnType<typeof vi.fn<Params["payContactWithCashuMessage"]>>;
} = {}) => {
  appendStoredPendingPayment(key, entry);
  const update = vi.fn<Params["updateLocalNostrMessage"]>();
  const toast = vi.fn();
  const Harness = ({
    recipient,
    cashuBalance,
  }: {
    recipient: typeof contact;
    cashuBalance: number;
  }) => {
    const [cashuIsBusy, setCashuIsBusy] = React.useState(false);
    usePaymentsDomain({
      cashuBalance,
      cashuIsBusy,
      cashuReady: true,
      contacts: React.useMemo(() => [recipient], [recipient]),
      currentNpub: "self",
      currentNsec: "self-test-fixture",
      payContactWithCashuMessage: pay,
      pendingPaymentsKey: key,
      pushToast: toast,
      updateLocalNostrMessage: update,
      setCashuIsBusy,
      t: (key) => key,
    });
    return null;
  };
  const mounted = await renderIntoDocument(
    <Harness recipient={initialContact} cashuBalance={0} />,
  );
  cleanups.push(mounted.unmount);
  return {
    pay,
    update,
    toast,
    rerender: (recipient: typeof contact, cashuBalance = 0) =>
      mounted.rerender(
        <Harness recipient={recipient} cashuBalance={cashuBalance} />,
      ),
  };
};

const goOnline = () =>
  act(async () => {
    online = true;
    window.dispatchEvent(new Event("online"));
  });

beforeEach(() => {
  localStorage.clear();
  online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  installCrossTabLocks();
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

describe("queued payment authorization", () => {
  it("flushes the pinned amount to the approved identity", async () => {
    const harness = await setup();
    await goOnline();
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
    expect(storedIds()).toEqual([]);
    expect(harness.toast).not.toHaveBeenCalled();
  });

  it("cancels a changed identity without attempting payment", async () => {
    const harness = await setup({
      initialContact: { ...contact, npub: encodeNpub(changed.pubkey) },
    });
    await goOnline();
    expect(harness.pay).not.toHaveBeenCalled();
    expect(storedIds()).toEqual([]);
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
    const harness = await setup({ entry: legacy });
    await goOnline();
    expect(harness.pay).not.toHaveBeenCalled();
    expect(storedIds()).toEqual([]);
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
    const harness = await setup({ entry: legacy });
    await goOnline();
    expect(harness.pay).not.toHaveBeenCalled();
    appendStoredPendingPayment(key, { ...pending, id: "new-approval" });
    await goOnline();
    expect(harness.pay).toHaveBeenCalledOnce();
    expect(storedIds()).toEqual([]);
  });

  it("invalidates an in-flight approval when the contact changes while preserving its frozen payment arguments", async () => {
    let finish: (() => void) | undefined;
    const harness = await setup({
      pay: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { ok: true, queued: false };
      }),
    });
    await goOnline();
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

describe("queued payment delivery", () => {
  it("sends a payment queued in two tabs only once", async () => {
    let finish: (() => void) | undefined;
    const pay = vi.fn<Params["payContactWithCashuMessage"]>(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { ok: true, queued: false };
    });
    await setup({ pay });
    await setup({ pay });
    await goOnline();
    await act(async () => {
      finish?.();
    });
    await goOnline();
    expect(pay).toHaveBeenCalledOnce();
    expect(storedIds()).toEqual([]);
  });

  it("skips an entry another tab already claimed", async () => {
    const harness = await setup();
    claimStoredPendingPayment(key, pending.id);
    await goOnline();
    expect(harness.pay).not.toHaveBeenCalled();
  });

  it("keeps the queue untouched with only the single-tab lock shim", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, callback: () => unknown) => callback(),
      },
    });
    const harness = await setup();
    await goOnline();
    expect(harness.pay).not.toHaveBeenCalled();
    expect(storedIds()).toEqual([pending.id]);
  });

  it.each<[string, () => Promise<PayResult>]>([
    ["fails", async () => ({ error: "swap failed", ok: false, queued: false })],
    [
      "throws",
      async () => {
        throw new Error("swap failed");
      },
    ],
  ])(
    "drops a payment whose attempt %s instead of minting another token",
    async (_label, attempt) => {
      const harness = await setup({ pay: vi.fn(attempt) });
      await goOnline();
      await goOnline();
      expect(harness.pay).toHaveBeenCalledOnce();
      expect(storedIds()).toEqual([]);
      expect(harness.update).toHaveBeenCalledWith(pending.messageId, {
        content: "payFailed: swap failed",
        status: "sent",
        localOnly: true,
      });
      expect(harness.toast).toHaveBeenCalledWith("payFailed: swap failed");
    },
  );

  it("keeps a payment queued when the attempt stopped before creating a token", async () => {
    const harness = await setup({
      pay: vi.fn(async () => ({
        error: "insufficient",
        ok: false,
        queued: false,
        retryable: true as const,
      })),
    });
    await goOnline();
    expect(harness.pay).toHaveBeenCalledOnce();
    expect(storedIds()).toEqual([pending.id]);
    expect(harness.toast).not.toHaveBeenCalled();
    harness.pay.mockResolvedValueOnce({ ok: true, queued: false });
    await harness.rerender(contact, 1_000);
    expect(harness.pay).toHaveBeenCalledTimes(2);
    expect(storedIds()).toEqual([]);
  });
});
