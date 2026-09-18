import * as Evolu from "@evolu/common";
import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
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

const owner = Evolu.createAppOwner(
  Evolu.OwnerSecret.orThrow(new Uint8Array(32).fill(9)),
);
const HOUR = 3600;
const DUE = 1_800_000_000;
const NOW = DUE + 90;

const contact: ContactRowLike = {
  id: "contact-1",
  name: "Alice",
  npub: "npub1alice",
};

const orderRow = (overrides: Record<string, unknown> = {}) => ({
  id: "rp-1",
  ownerId: owner.id,
  createdAtSec: DUE - HOUR,
  title: "Coffee",
  recipientKind: "contact",
  contactId: "contact-1",
  lnAddress: null,
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
  executorDeviceId: "device-a",
  note: null,
  ...overrides,
});

const mount = async (overrides: Partial<Params> = {}) => {
  const params: Params = {
    appendLocalNostrMessage: vi.fn(() => "local-1"),
    cashuBalance: 1_000,
    cashuIsBusy: false,
    contacts: [contact],
    currentNsec: null,
    enabled: true,
    enqueueOutbox: null,
    payContactWithCashuMessage: vi.fn(async () => ({ ok: true })),
    payLightningAddressWithCashu: vi.fn(async () => true),
    setCashuIsBusy: vi.fn(),
    t: (key) => key,
    update: vi.fn<Params["update"]>(),
    updateLocalNostrMessage: vi.fn(),
    dependencies: { deviceId: "device-a", nowSec: () => NOW },
    ...overrides,
  };
  const Probe = () => {
    useRecurringPaymentsScheduler(params);
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...view, params };
};

beforeEach(() => {
  loadQueryMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRecurringPaymentsScheduler", () => {
  it("claims a due contact order, pays it, and marks it paid", async () => {
    loadQueryMock.mockResolvedValue([orderRow()]);
    const view = await mount();

    expect(view.params.payContactWithCashuMessage).toHaveBeenCalledWith({
      amountSat: 100,
      contact,
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
    expect(view.params.update).toHaveBeenNthCalledWith(
      2,
      "recurringPayment",
      { id: "rp-1", lastRunStatus: "paid" },
      { ownerId: owner.id },
    );
    expect(view.params.setCashuIsBusy).toHaveBeenCalledWith(true);
    expect(view.params.setCashuIsBusy).toHaveBeenLastCalledWith(false);
    expect(reportAppLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "recurring.run" }),
    );
    await view.unmount();
  });

  it("pays a lightning address order without touching the busy flag itself", async () => {
    loadQueryMock.mockResolvedValue([
      orderRow({
        recipientKind: "lnAddress",
        contactId: null,
        lnAddress: "alice@example.com",
      }),
    ]);
    const view = await mount();

    expect(view.params.payLightningAddressWithCashu).toHaveBeenCalledWith(
      "alice@example.com",
      100,
      { recurringRun: { recurringPaymentId: "rp-1", dueAtSec: DUE } },
    );
    expect(view.params.setCashuIsBusy).not.toHaveBeenCalled();
    expect(view.params.update).toHaveBeenLastCalledWith(
      "recurringPayment",
      { id: "rp-1", lastRunStatus: "paid" },
      { ownerId: owner.id },
    );
    await view.unmount();
  });

  it("rolls the schedule back when the payment fails", async () => {
    loadQueryMock.mockResolvedValue([orderRow()]);
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
    expect(reportAppLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: "recurring.run",
        payload: expect.objectContaining({
          status: "failed",
          error: "mint down",
        }),
      }),
    );
    await view.unmount();
  });

  it("does not pay when the wallet is busy or the order belongs elsewhere", async () => {
    loadQueryMock.mockResolvedValue([
      orderRow(),
      orderRow({ id: "rp-2", executorDeviceId: "device-b" }),
    ]);
    const busy = await mount({ cashuIsBusy: true });
    expect(busy.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    expect(busy.params.update).not.toHaveBeenCalled();
    await busy.unmount();

    loadQueryMock.mockResolvedValue([
      orderRow({ id: "rp-2", executorDeviceId: "device-b" }),
    ]);
    const foreign = await mount();
    expect(foreign.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    await foreign.unmount();
  });

  it("waits for funds without paying and reports it once", async () => {
    loadQueryMock.mockResolvedValue([orderRow({ amountSat: 5_000 })]);
    const view = await mount();

    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    expect(view.params.update).not.toHaveBeenCalled();
    expect(reportAppLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "recurring.waitingForFunds" }),
    );
    await view.unmount();
  });

  it("skips an order whose contact is gone and moves the schedule on", async () => {
    loadQueryMock.mockResolvedValue([orderRow({ contactId: "contact-x" })]);
    const view = await mount();

    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
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
    await view.unmount();
  });

  it("pays an order on demand and consumes its pending period", async () => {
    const future = DUE + 5 * HOUR; // not due yet
    loadQueryMock.mockResolvedValue([orderRow({ nextDueAtSec: future })]);
    const params: Params = {
      appendLocalNostrMessage: vi.fn(() => "local-1"),
      cashuBalance: 1_000,
      cashuIsBusy: false,
      contacts: [contact],
      currentNsec: null,
      enabled: true,
      enqueueOutbox: null,
      payContactWithCashuMessage: vi.fn(async () => ({ ok: true })),
      payLightningAddressWithCashu: vi.fn(async () => true),
      setCashuIsBusy: vi.fn(),
      t: (key) => key,
      update: vi.fn<Params["update"]>(),
      updateLocalNostrMessage: vi.fn(),
      dependencies: { deviceId: "device-a", nowSec: () => NOW },
    };
    let scheduler: ReturnType<typeof useRecurringPaymentsScheduler> | null =
      null;
    const Probe = ({
      onReady,
    }: {
      onReady: (
        value: ReturnType<typeof useRecurringPaymentsScheduler>,
      ) => void;
    }) => {
      const value = useRecurringPaymentsScheduler(params);
      React.useEffect(() => onReady(value), [onReady, value]);
      return null;
    };
    const view = await renderIntoDocument(
      <Probe
        onReady={(value) => {
          scheduler = value;
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(params.payContactWithCashuMessage).not.toHaveBeenCalled();

    let outcome: string | null = null;
    await act(async () => {
      outcome = (await scheduler?.runOrderNow("rp-1")) ?? null;
    });
    expect(outcome).toBe("paid");
    expect(params.payContactWithCashuMessage).toHaveBeenCalledTimes(1);
    expect(params.update).toHaveBeenNthCalledWith(
      1,
      "recurringPayment",
      {
        id: "rp-1",
        lastRunAtSec: NOW,
        lastRunStatus: "running",
        // The pending 5 h slot is consumed: next is the one after it.
        nextDueAtSec: future + HOUR,
        runCount: 1,
      },
      { ownerId: owner.id },
    );
    await view.unmount();
  });

  it("does nothing while the runtime is not composed", async () => {
    loadQueryMock.mockResolvedValue([orderRow()]);
    const view = await mount({ enabled: false });
    expect(loadQueryMock).not.toHaveBeenCalled();
    await view.unmount();
  });
});
