import {
  RECURRING_REMINDER_GRACE_SEC,
  type RecurringPaymentOrder,
} from "@linky-fit/recurring-payment";
import { generateSecretKey } from "nostr-tools";
import { act } from "react";
import { nsecEncode } from "nostr-tools/nip19";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DUE,
  HOUR,
  recurringOrderFixture,
  recurringPaymentIdFor,
} from "../../../testUtils/recurringOrders";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useRecurringReminderSync } from "./useRecurringReminderSync";

type Params = Parameters<typeof useRecurringReminderSync>[0];

const NSEC = nsecEncode(generateSecretKey());
const GRACE = RECURRING_REMINDER_GRACE_SEC;

const rent = recurringOrderFixture({ note: "Rent" });
const unnamed = recurringOrderFixture({ id: recurringPaymentIdFor("rp-2") });
const gym = recurringOrderFixture({
  id: recurringPaymentIdFor("rp-3"),
  note: "Gym",
  schedule: { ...recurringOrderFixture().schedule, nextDueAtSec: DUE + HOUR },
});

const Probe = ({ params }: { params: Params }) => {
  useRecurringReminderSync(params);
  return null;
};

const mount = async (orders: ReadonlyArray<RecurringPaymentOrder>) => {
  const dependencies = {
    storeReminderNotes: vi.fn(async () => {}),
    syncRecurringReminders: vi.fn(async () => ({ success: true })),
  };
  const params = (next: ReadonlyArray<RecurringPaymentOrder>): Params => ({
    currentNsec: NSEC,
    dependencies,
    enabled: true,
    orders: next,
  });
  const view = await renderIntoDocument(<Probe params={params(orders)} />);
  const settle = () => vi.advanceTimersByTimeAsync(2_000);
  await settle();
  return {
    ...dependencies,
    settle,
    unmount: view.unmount,
    setOrders: (next: ReadonlyArray<RecurringPaymentOrder>) =>
      view.rerender(<Probe params={params(next)} />),
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime((DUE - HOUR) * 1000);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("useRecurringReminderSync", () => {
  it("syncs only the reminder times and keeps the notes due at each on the device", async () => {
    const view = await mount([rent, unnamed, gym]);
    await vi.waitFor(() =>
      expect(view.syncRecurringReminders).toHaveBeenCalledWith(NSEC, [
        DUE + GRACE,
        DUE + HOUR + GRACE,
      ]),
    );
    expect(view.storeReminderNotes).toHaveBeenCalledWith(
      new Map([
        [DUE + GRACE, ["Rent", null]],
        [DUE + HOUR + GRACE, ["Gym"]],
      ]),
    );
    await view.unmount();
  });

  it("stores an edited note without syncing unchanged times again", async () => {
    const view = await mount([rent, gym]);
    await vi.waitFor(() =>
      expect(view.syncRecurringReminders).toHaveBeenCalledTimes(1),
    );

    await view.setOrders([{ ...rent, note: "Rent October" }, gym]);
    await view.settle();
    await vi.waitFor(() =>
      expect(view.storeReminderNotes).toHaveBeenLastCalledWith(
        new Map([
          [DUE + GRACE, ["Rent October"]],
          [DUE + HOUR + GRACE, ["Gym"]],
        ]),
      ),
    );
    expect(view.syncRecurringReminders).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("syncs without push registration", async () => {
    const view = await mount([rent]);
    await vi.waitFor(() =>
      expect(view.syncRecurringReminders).toHaveBeenCalledWith(NSEC, [
        DUE + GRACE,
      ]),
    );
    await view.unmount();
  });

  it("resyncs when a due time passes, well inside the grace", async () => {
    const view = await mount([rent, gym]);
    await vi.waitFor(() =>
      expect(view.syncRecurringReminders).toHaveBeenCalledTimes(1),
    );

    await act(() => vi.advanceTimersByTimeAsync(HOUR * 1000));
    await view.settle();
    await vi.waitFor(() =>
      expect(view.syncRecurringReminders).toHaveBeenLastCalledWith(NSEC, [
        DUE + HOUR + GRACE,
      ]),
    );
    expect(Date.now()).toBeLessThan((DUE + GRACE) * 1000);
    await view.unmount();
  });
});
