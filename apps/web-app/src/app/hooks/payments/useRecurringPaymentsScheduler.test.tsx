import {
  createId,
  makeRecurringPaymentsRepository,
  makeTransactionsRepository,
  NonEmptyString,
  NonEmptyString100,
  NonNegativeInt,
  PositiveInt,
  type RecurringPaymentId,
  type RecurringPaymentsRepository,
} from "@linky/linksync";
import {
  RECURRING_CONFIRM_SEC,
  RECURRING_NOTICE_SEC,
} from "@linky/recurring-payment";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import {
  contactIdFor,
  DUE,
  HOUR,
  recurringPaymentIdFor,
} from "../../../testUtils/recurringOrders";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { ContactRowLike } from "../../types/appTypes";
import { useRecurringPaymentsScheduler } from "./useRecurringPaymentsScheduler";

const reportAppLogMock = vi.hoisted(() => vi.fn());
vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: reportAppLogMock,
}));

type Params = Parameters<typeof useRecurringPaymentsScheduler>[0];
type Scheduler = ReturnType<typeof useRecurringPaymentsScheduler>;

const NOW = DUE + 90;
const ORDER_ID = recurringPaymentIdFor("rp-1");
const NOSTR_CONTACT_ID = contactIdFor("contact-1");
const LIGHTNING_CONTACT_ID = contactIdFor("contact-2");

const nostrContact: ContactRowLike = {
  id: NOSTR_CONTACT_ID,
  name: "Alice",
  npub: "npub1alice",
};
const lightningContact: ContactRowLike = {
  id: LIGHTNING_CONTACT_ID,
  name: "Bob",
  lnAddress: "bob@example.com",
};

const int = PositiveInt.orThrow;
const text = NonEmptyString100.orThrow;

interface RowOverrides {
  amount?: number;
  claimDeviceId?: string;
  claimAtSec?: number;
  claimDueAtSec?: number;
  contactId?: ReturnType<typeof contactIdFor>;
  lastRunAtSec?: number;
  lastRunStatus?: string;
  nextDueAtSec?: number;
  runCount?: number;
  unit?: string;
}

const insertOrder = (
  repository: RecurringPaymentsRepository,
  overrides: RowOverrides = {},
): void => {
  const nextDueAtSec = overrides.nextDueAtSec ?? DUE;
  Effect.runSync(
    repository.insert({
      id: ORDER_ID,
      createdAtSec: int(DUE - HOUR),
      contactId: overrides.contactId ?? NOSTR_CONTACT_ID,
      amount: int(overrides.amount ?? 100),
      unit: text(overrides.unit ?? "sat"),
      intervalUnit: text("hour"),
      intervalCount: int(6),
      anchorAtSec: int(DUE),
      timeZone: text("UTC"),
      nextDueAtSec: int(nextDueAtSec),
      runCount: NonNegativeInt.orThrow(overrides.runCount ?? 0),
      ...(overrides.lastRunAtSec === undefined
        ? {}
        : { lastRunAtSec: int(overrides.lastRunAtSec) }),
      ...(overrides.lastRunStatus === undefined
        ? {}
        : { lastRunStatus: text(overrides.lastRunStatus) }),
      ...(overrides.claimDeviceId
        ? {
            claimDeviceId: text(overrides.claimDeviceId),
            claimAtSec: int(
              overrides.claimAtSec ?? nextDueAtSec - RECURRING_NOTICE_SEC,
            ),
            claimDueAtSec: int(overrides.claimDueAtSec ?? nextDueAtSec),
          }
        : {}),
    }),
  );
};

const claimedBy = (deviceId: string, atSec?: number): RowOverrides => ({
  claimDeviceId: deviceId,
  ...(atSec === undefined ? {} : { claimAtSec: atSec }),
});

const readRow = (repository: RecurringPaymentsRepository) =>
  Effect.runSync(repository.byId(ORDER_ID));

const makeParams = (
  repository: RecurringPaymentsRepository,
  transactions: Params["transactions"],
  overrides: Partial<Params> = {},
): Params => ({
  cashuBalance: 1_000,
  cashuIsBusy: false,
  contacts: [nostrContact, lightningContact],
  enabled: true,
  fiatRates: null,
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
  repository,
  setCashuIsBusy: vi.fn(),
  showPaidOverlay: vi.fn(),
  t: (key) => key,
  transactions,
  dependencies: {
    deviceId: "device-a",
    // Background by default: the countdown is a separate scenario.
    isVisible: () => false,
    nowSec: () => NOW,
  },
  ...overrides,
});

const Probe = ({
  onRender,
  params,
}: {
  onRender: (scheduler: Scheduler) => void;
  params: Params;
}) => {
  onRender(useRecurringPaymentsScheduler(params));
  return null;
};

// Repository reads and writes run through Effect fibers, which resolve over
// several macrotasks, not just microtasks.
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

interface MountOverrides {
  params?: Partial<Params>;
  beforeMount?: (
    transactions: Params["transactions"] & TransactionsWriter,
  ) => void;
}

type TransactionsWriter = Pick<
  ReturnType<typeof makeTransactionsRepository>,
  "insert"
>;

const mount = async (
  rows: RowOverrides | null = {},
  overrides: MountOverrides = {},
) => {
  const { store } = makeTestLinkyStore();
  const repository = makeRecurringPaymentsRepository(store);
  const transactions = makeTransactionsRepository(store);
  if (rows !== null) insertOrder(repository, rows);
  overrides.beforeMount?.(transactions);
  const params = makeParams(repository, transactions, overrides.params);
  let scheduler: Scheduler | null = null;
  const view = await renderIntoDocument(
    <Probe
      params={params}
      onRender={(value) => {
        scheduler = value;
      }}
    />,
  );
  await settle();
  const current = (): Scheduler => {
    if (scheduler === null) throw new Error("scheduler not ready");
    return scheduler;
  };
  return {
    ...view,
    params,
    repository,
    row: () => readRow(repository),
    scheduler: current,
    runOrderNow: async (id: RecurringPaymentId) => {
      let outcome: string | null = null;
      await act(async () => {
        outcome = await current().runOrderNow(id);
      });
      await settle();
      return outcome;
    },
  };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("useRecurringPaymentsScheduler", () => {
  it("claims a due payment for this device and notifies the user", async () => {
    const view = await mount();

    expect(view.row()).toMatchObject({
      claimDeviceId: "device-a",
      claimAtSec: NOW,
      claimDueAtSec: DUE,
    });
    expect(view.params.maybeShowPwaNotification).toHaveBeenCalledWith(
      "recurringPaymentTitle",
      "recurringNotifyBody",
      `recurring:${ORDER_ID}:${DUE}`,
    );
    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("pays its own claim over cashu in the background and confirms it", async () => {
    const view = await mount(claimedBy("device-a"));

    expect(view.params.payContactWithCashuMessage).toHaveBeenCalledWith({
      amountSat: 100,
      contact: nostrContact,
      fromQueue: true,
      recurringRun: { recurringPaymentId: ORDER_ID, dueAtSec: DUE },
    });
    expect(view.row()).toMatchObject({
      lastRunAtSec: NOW,
      lastRunStatus: "paid",
      nextDueAtSec: DUE + 6 * HOUR,
      runCount: 1,
    });
    expect(view.params.showPaidOverlay).toHaveBeenCalledWith("paidSentTo", {
      direction: "out",
      amountSat: 100,
      contact: { name: "Alice", npub: "npub1alice" },
    });
    expect(view.params.setCashuIsBusy).toHaveBeenLastCalledWith(false);
    expect(view.scheduler().dueConfirmation).toBeNull();
    await view.unmount();
  });

  it("converts a fiat payment at the current rate and waits without one", async () => {
    const czk = { ...claimedBy("device-a"), amount: 15_000, unit: "czk" };
    const waiting = await mount(czk);
    expect(waiting.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    expect(waiting.params.pushToast).toHaveBeenCalledWith(
      "recurringWaitingForRates",
    );
    await waiting.unmount();

    const rates = {
      chfPerBtc: 90_000,
      czkPerBtc: 2_000_000,
      eurPerBtc: 100_000,
      fetchedAtMs: 1,
      usdPerBtc: 110_000,
    };
    const paying = await mount(czk, {
      params: { cashuBalance: 10_000, fiatRates: rates },
    });
    expect(paying.params.payContactWithCashuMessage).toHaveBeenCalledWith(
      expect.objectContaining({ amountSat: 7_500 }),
    );
    await paying.unmount();
  });

  it("pays a contact without an npub to its Lightning address", async () => {
    const view = await mount({
      ...claimedBy("device-a"),
      contactId: LIGHTNING_CONTACT_ID,
    });

    expect(view.params.payLightningAddressWithCashu).toHaveBeenCalledWith(
      "bob@example.com",
      100,
      { recurringRun: { recurringPaymentId: ORDER_ID, dueAtSec: DUE } },
    );
    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    expect(view.params.showPaidOverlay).toHaveBeenCalled();
    await view.unmount();
  });

  it("leaves a payment claimed by another device alone", async () => {
    const view = await mount(claimedBy("device-b"));

    expect(view.row()).toMatchObject({
      claimDeviceId: "device-b",
      lastRunStatus: null,
    });
    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("rolls the schedule back and tells the user when the payment fails", async () => {
    const view = await mount(claimedBy("device-a"), {
      params: {
        payContactWithCashuMessage: vi.fn(async () => ({
          ok: false,
          error: "mint down",
        })),
      },
    });

    expect(view.row()).toMatchObject({
      lastRunStatus: "failed",
      nextDueAtSec: DUE,
      runCount: 0,
    });
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringRunFailedToast",
    );
    expect(view.params.showPaidOverlay).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("does not pay while the wallet is busy", async () => {
    const view = await mount(claimedBy("device-a"), {
      params: { cashuIsBusy: true },
    });
    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("waits for funds and tells the user once", async () => {
    const view = await mount({ ...claimedBy("device-a"), amount: 5_000 });

    expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringWaitingForFunds",
    );
    await view.unmount();
  });

  it("skips a payment whose contact is gone and moves the schedule on", async () => {
    const view = await mount({
      ...claimedBy("device-a"),
      contactId: contactIdFor("contact-x"),
    });

    expect(view.row()).toMatchObject({
      lastRunAtSec: NOW,
      lastRunStatus: "skipped",
      nextDueAtSec: DUE + 6 * HOUR,
      runCount: 1,
    });
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringRecipientUnavailable",
    );
    await view.unmount();
  });

  it("pays on demand, claiming it and consuming the pending period", async () => {
    const future = DUE + 5 * HOUR; // not inside the notice window yet
    const view = await mount({ nextDueAtSec: future });
    expect(view.row()).toMatchObject({ claimDeviceId: null });

    const outcome = await view.runOrderNow(ORDER_ID);
    expect(outcome).toBe("paid");
    expect(view.row()).toMatchObject({
      claimDeviceId: "device-a",
      claimAtSec: NOW,
      claimDueAtSec: future,
      lastRunStatus: "paid",
      // The pending slot is consumed: next is the one after it.
      nextDueAtSec: future + HOUR,
      runCount: 1,
    });
    expect(view.params.payContactWithCashuMessage).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("does nothing while the runtime is not composed", async () => {
    const view = await mount({}, { params: { enabled: false } });
    expect(view.row()).toMatchObject({ claimDeviceId: null });
    await view.unmount();
  });

  describe("a run that never finished", () => {
    // The run for DUE was claimed and started; its schedule already moved on.
    const interrupted = {
      ...claimedBy("device-a"),
      claimDueAtSec: DUE,
      lastRunAtSec: NOW - HOUR,
      lastRunStatus: "running",
      nextDueAtSec: DUE + 6 * HOUR,
      runCount: 1,
    };

    it("restores the due time when the history holds no payment for it", async () => {
      const view = await mount(interrupted);
      expect(view.row()).toMatchObject({
        lastRunStatus: "interrupted",
        nextDueAtSec: DUE,
        runCount: 0,
      });
      expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
      await view.unmount();
    });

    it("marks it paid when the history already records the payment", async () => {
      const view = await mount(interrupted, {
        beforeMount: (transactions) => {
          Effect.runSync(
            transactions.insert({
              id: createId<"Transaction">(),
              createdAtSec: int(NOW - HOUR),
              direction: text("out"),
              status: text("ok"),
              method: text("cashu_chat"),
              detailsJson: NonEmptyString.orThrow(
                JSON.stringify({
                  recurringPaymentId: ORDER_ID,
                  recurringDueAtSec: DUE,
                }),
              ),
            }),
          );
        },
      });
      expect(view.row()).toMatchObject({
        lastRunStatus: "paid",
        nextDueAtSec: DUE + 6 * HOUR,
        runCount: 1,
      });
      await view.unmount();
    });
  });

  describe("while Linky is visible", () => {
    const visible = {
      deviceId: "device-a",
      isVisible: () => true,
      nowSec: () => NOW,
    };

    it("shows the countdown instead of paying", async () => {
      const view = await mount(claimedBy("device-a"), {
        params: { dependencies: visible },
      });

      expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
      expect(view.scheduler().dueConfirmation).toEqual({
        orderId: ORDER_ID,
        dueAtSec: DUE,
        amountSat: 100,
        sendAtSec: NOW + RECURRING_CONFIRM_SEC,
      });
      expect(view.row()).toMatchObject({ lastRunStatus: null });

      // Another pass keeps the running countdown instead of restarting it.
      await act(async () => {
        await view.scheduler().runNow();
      });
      expect(view.scheduler().dueConfirmation?.sendAtSec).toBe(
        NOW + RECURRING_CONFIRM_SEC,
      );
      await view.unmount();
    });

    it("pays when the user confirms", async () => {
      const view = await mount(claimedBy("device-a"), {
        params: { dependencies: visible },
      });
      await act(async () => {
        await view.scheduler().confirmDueNow();
      });
      await settle();

      expect(view.params.payContactWithCashuMessage).toHaveBeenCalledTimes(1);
      expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
      expect(view.scheduler().dueConfirmation).toBeNull();
      await view.unmount();
    });

    it("skips the period when the user cancels", async () => {
      const view = await mount(claimedBy("device-a"), {
        params: { dependencies: visible },
      });
      await act(async () => {
        await view.scheduler().cancelDue();
      });
      await settle();

      expect(view.params.payContactWithCashuMessage).not.toHaveBeenCalled();
      expect(view.row()).toMatchObject({
        lastRunAtSec: NOW,
        lastRunStatus: "skipped",
        nextDueAtSec: DUE + 6 * HOUR,
        runCount: 1,
      });
      expect(view.params.pushToast).toHaveBeenCalledWith(
        "recurringCancelledToast",
      );
      expect(view.scheduler().dueConfirmation).toBeNull();
      await view.unmount();
    });
  });
});
