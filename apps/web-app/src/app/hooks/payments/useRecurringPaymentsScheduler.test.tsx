import * as Evolu from "@evolu/common";
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { RECURRING_NOTICE_SEC } from "../../lib/recurringPaymentTick";
import type { ContactRowLike } from "../../types/appTypes";
import { useRecurringPaymentsScheduler } from "./useRecurringPaymentsScheduler";

const { loadQueryMock } = vi.hoisted(() => ({
  loadQueryMock: vi.fn<() => Promise<ReadonlyArray<Record<string, unknown>>>>(),
}));

vi.mock("../../../evolu", () => ({
  evolu: {
    createQuery: () => "recurring-payments",
    loadQuery: loadQueryMock,
  },
}));

const reportAppLogMock = vi.hoisted(() => vi.fn());
vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: reportAppLogMock,
}));

type Params = Parameters<typeof useRecurringPaymentsScheduler>[0];
type Scheduler = ReturnType<typeof useRecurringPaymentsScheduler>;

const owner = Evolu.createAppOwner(
  Evolu.OwnerSecret.orThrow(new Uint8Array(32).fill(9)),
);
const HOUR = 3600;
const DUE = 1_800_000_000;
const NOW = DUE + 90;

const nostrContact: ContactRowLike = {
  id: "contact-1",
  name: "Alice",
  npub: "npub1alice",
};
const lightningContact: ContactRowLike = {
  id: "contact-2",
  name: "Bob",
  lnAddress: "bob@example.com",
};

const orderRow = (overrides: Record<string, unknown> = {}) => ({
  id: "rp-1",
  ownerId: owner.id,
  createdAtSec: DUE - HOUR,
  contactId: "contact-1",
  amountSat: 100,
  intervalUnit: "hour",
  intervalCount: 6,
  anchorAtSec: DUE,
  timeZone: "UTC",
  nextDueAtSec: DUE,
  lastRunAtSec: null,
  lastRunStatus: null,
  runCount: 0,
  maxRuns: null,
  endAtSec: null,
  pausedAtSec: null,
  claimDeviceId: null,
  claimAtSec: null,
  claimDueAtSec: null,
  ...overrides,
});

const claimedBy = (deviceId: string, atSec = DUE - RECURRING_NOTICE_SEC) => ({
  claimDeviceId: deviceId,
  claimAtSec: atSec,
  claimDueAtSec: DUE,
});

const makeParams = (overrides: Partial<Params> = {}): Params => ({
  appendLocalNostrMessage: vi.fn(() => "local-1"),
  cashuBalance: 1_000,
  cashuIsBusy: false,
  contacts: [nostrContact, lightningContact],
  currentNsec: null,
  enabled: true,
  enqueueOutbox: null,
  formatDisplayedAmountParts: (amountSat) => ({
    amountText: String(amountSat),
    approxPrefix: "",
    unitLabel: "sat",
  }),
  maybeShowPwaNotification: vi.fn(async () => {}),
  payContactWithCashuMessage: vi.fn(async () => ({ ok: true })),
  payLightningAddressWithCashu: vi.fn(async () => true),
  payWithCashuEnabled: true,
  pushToast: vi.fn(),
  setCashuIsBusy: vi.fn(),
  showPaidOverlay: vi.fn(),
  t: (key) => key,
  update: vi.fn<Params["update"]>(),
  updateLocalNostrMessage: vi.fn(),
  dependencies: { deviceId: "device-a", nowSec: () => NOW },
  ...overrides,
});

const Probe = ({
  onReady,
  params,
}: {
  onReady: (scheduler: Scheduler) => void;
  params: Params;
}) => {
  const scheduler = useRecurringPaymentsScheduler(params);
  React.useEffect(() => onReady(scheduler), [onReady, scheduler]);
  return null;
};

const mount = async (overrides: Partial<Params> = {}) => {
  const params = makeParams(overrides);
  let scheduler: Scheduler | null = null;
  const view = await renderIntoDocument(
    <Probe
      params={params}
      onReady={(value) => {
        scheduler = value;
      }}
    />,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    ...view,
    params,
    runOrderNow: (id: string) => {
      if (scheduler === null) throw new Error("scheduler not ready");
      return scheduler.runOrderNow(id);
    },
  };
};

beforeEach(() => {
  loadQueryMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRecurringPaymentsScheduler", () => {
  it("claims a due payment for this device and notifies the user", async () => {
    loadQueryMock.mockResolvedValue([orderRow()]);
    const view = await mount();

    expect(view.params.update).toHaveBeenCalledWith(
      "recurringPayment",
      {
        id: "rp-1",
        claimDeviceId: "device-a",
        claimAtSec: NOW,
        claimDueAtSec: DUE,
      },
      { ownerId: owner.id },
    );
    expect(view.params.maybeShowPwaNotification).toHaveBeenCalledWith(
      "recurringPaymentTitle",
      "recurringNotifyBody",
      `recurring:rp-1:${DUE}`,
    );
    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("pays its own claim over cashu after the notice window and confirms it", async () => {
    loadQueryMock.mockResolvedValue([orderRow(claimedBy("device-a"))]);
    const view = await mount();

    expect(view.params.payContactWithCashuMessage).toHaveBeenCalledWith({
      amountSat: 100,
      contact: nostrContact,
      fromQueue: true,
      recurringRun: { recurringPaymentId: "rp-1", dueAtSec: DUE },
    });
    expect(view.params.update).toHaveBeenNthCalledWith(
      1,
      "recurringPayment",
      {
        id: "rp-1",
        lastRunAtSec: NOW,
        lastRunStatus: "running",
        nextDueAtSec: DUE + 6 * HOUR,
        runCount: 1,
      },
      { ownerId: owner.id },
    );
    expect(view.params.update).toHaveBeenLastCalledWith(
      "recurringPayment",
      { id: "rp-1", lastRunStatus: "paid" },
      { ownerId: owner.id },
    );
    expect(view.params.showPaidOverlay).toHaveBeenCalledWith("paidSentTo");
    expect(view.params.setCashuIsBusy).toHaveBeenLastCalledWith(false);
    await view.unmount();
  });

  it("pays a contact without an npub to its Lightning address", async () => {
    loadQueryMock.mockResolvedValue([
      orderRow({ contactId: "contact-2", ...claimedBy("device-a") }),
    ]);
    const view = await mount();

    expect(view.params.payLightningAddressWithCashu).toHaveBeenCalledWith(
      "bob@example.com",
      100,
      lightningContact,
      { recurringRun: { recurringPaymentId: "rp-1", dueAtSec: DUE } },
    );
    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    expect(view.params.showPaidOverlay).toHaveBeenCalled();
    await view.unmount();
  });

  it("leaves a payment claimed by another device alone", async () => {
    loadQueryMock.mockResolvedValue([orderRow(claimedBy("device-b"))]);
    const view = await mount();

    expect(view.params.update).not.toHaveBeenCalled();
    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("rolls the schedule back and tells the user when the payment fails", async () => {
    loadQueryMock.mockResolvedValue([orderRow(claimedBy("device-a"))]);
    const view = await mount({
      payContactWithCashuMessage: vi.fn(async () => ({
        ok: false,
        error: "mint down",
      })),
    });

    expect(view.params.update).toHaveBeenLastCalledWith(
      "recurringPayment",
      { id: "rp-1", lastRunStatus: "failed", nextDueAtSec: DUE, runCount: 0 },
      { ownerId: owner.id },
    );
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringRunFailedToast",
    );
    expect(view.params.showPaidOverlay).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("does not pay while the wallet is busy", async () => {
    loadQueryMock.mockResolvedValue([orderRow(claimedBy("device-a"))]);
    const view = await mount({ cashuIsBusy: true });
    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("waits for funds and tells the user once", async () => {
    loadQueryMock.mockResolvedValue([
      orderRow({ amountSat: 5_000, ...claimedBy("device-a") }),
    ]);
    const view = await mount();

    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringWaitingForFunds",
    );
    await view.unmount();
  });

  it("skips a payment whose contact is gone and moves the schedule on", async () => {
    loadQueryMock.mockResolvedValue([
      orderRow({ contactId: "contact-x", ...claimedBy("device-a") }),
    ]);
    const view = await mount();

    expect(view.params.update).toHaveBeenCalledWith(
      "recurringPayment",
      {
        id: "rp-1",
        lastRunAtSec: NOW,
        lastRunStatus: "skipped",
        nextDueAtSec: DUE + 6 * HOUR,
        runCount: 1,
      },
      { ownerId: owner.id },
    );
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringRecipientUnavailable",
    );
    await view.unmount();
  });

  it("pays on demand, claiming it and consuming the pending period", async () => {
    const future = DUE + 5 * HOUR; // not inside the notice window yet
    loadQueryMock.mockResolvedValue([orderRow({ nextDueAtSec: future })]);
    const view = await mount();
    expect(view.params.update).not.toHaveBeenCalled();

    let outcome: string | null = null;
    await act(async () => {
      outcome = await view.runOrderNow("rp-1");
    });
    expect(outcome).toBe("paid");
    expect(view.params.update).toHaveBeenNthCalledWith(
      1,
      "recurringPayment",
      {
        id: "rp-1",
        claimDeviceId: "device-a",
        claimAtSec: NOW,
        claimDueAtSec: future,
      },
      { ownerId: owner.id },
    );
    expect(view.params.update).toHaveBeenNthCalledWith(
      2,
      "recurringPayment",
      {
        id: "rp-1",
        lastRunAtSec: NOW,
        lastRunStatus: "running",
        // The pending slot is consumed: next is the one after it.
        nextDueAtSec: future + HOUR,
        runCount: 1,
      },
      { ownerId: owner.id },
    );
    expect(view.params.payContactWithCashuMessage).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("does nothing while the runtime is not composed", async () => {
    loadQueryMock.mockResolvedValue([orderRow()]);
    const view = await mount({ enabled: false });
    expect(loadQueryMock).not.toHaveBeenCalled();
    await view.unmount();
  });
});
