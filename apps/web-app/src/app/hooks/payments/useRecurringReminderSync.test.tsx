import type { RecurringPaymentOrder } from "@linky-fit/recurring-payment";
import { generateSecretKey } from "nostr-tools";
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

const mount = async (
  orders: ReadonlyArray<RecurringPaymentOrder>,
  registered = true,
) => {
  const dependencies = {
    isPushRegisteredForIdentity: () => registered,
    nowSec: () => DUE - HOUR,
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
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("useRecurringReminderSync", () => {
  it("syncs only the due times and keeps the notes due at each on the device", async () => {
    const view = await mount([rent, unnamed, gym]);
    await vi.waitFor(() =>
      expect(view.syncRecurringReminders).toHaveBeenCalledWith(NSEC, [
        DUE,
        DUE + HOUR,
      ]),
    );
    expect(view.storeReminderNotes).toHaveBeenCalledWith(
      new Map([
        [DUE, ["Rent", null]],
        [DUE + HOUR, ["Gym"]],
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
          [DUE, ["Rent October"]],
          [DUE + HOUR, ["Gym"]],
        ]),
      ),
    );
    expect(view.syncRecurringReminders).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it("does nothing while this install has no push registration", async () => {
    const view = await mount([rent], false);
    await view.settle();
    expect(view.storeReminderNotes).not.toHaveBeenCalled();
    expect(view.syncRecurringReminders).not.toHaveBeenCalled();
    await view.unmount();
  });
});
