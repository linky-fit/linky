import { makeIdentity } from "@linky-fit/linkstr/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  safeLocalStorageRemove,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import {
  appendStoredPendingPayment,
  claimStoredPendingPayment,
  enqueueStoredPendingPayment,
  readPendingPayments,
  withPendingPaymentsFlushLock,
} from "./pendingPayments";

const key = "linky.test.pending-payments";
const payment = {
  id: "queue-1",
  contactId: "contact-1",
  amountSat: 600,
  createdAtSec: 1,
  messageId: "placeholder-1",
};
afterEach(() => safeLocalStorageRemove(key));

describe("pending payment persistence", () => {
  it("round-trips the approved recipient key and amount through production storage helpers", () => {
    const approved = { ...payment, recipientPubkey: makeIdentity().pubkey };
    safeLocalStorageSetJson(key, [approved]);
    expect(readPendingPayments(key)).toEqual([approved]);
  });

  it("keeps legacy and invalid-key entries readable without approving any identity", () => {
    safeLocalStorageSetJson(key, [
      payment,
      { ...payment, id: "invalid-key", recipientPubkey: "not-a-key" },
    ]);
    expect(readPendingPayments(key)).toEqual([
      payment,
      { ...payment, id: "invalid-key" },
    ]);
  });
});

describe("pending payment claims", () => {
  it("hands an entry to exactly one claimer", () => {
    appendStoredPendingPayment(key, payment);
    expect(claimStoredPendingPayment(key, payment.id)).toEqual(payment);
    expect(claimStoredPendingPayment(key, payment.id)).toBeNull();
    expect(readPendingPayments(key)).toEqual([]);
  });

  it("restores a claimed entry without duplicating it", () => {
    appendStoredPendingPayment(key, payment);
    appendStoredPendingPayment(key, payment);
    expect(readPendingPayments(key)).toEqual([payment]);
  });
});

describe("pending payment queue lock", () => {
  it("does not claim an entry whose removal did not persist", () => {
    appendStoredPendingPayment(key, payment);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(claimStoredPendingPayment(key, payment.id)).toBeNull();
    vi.restoreAllMocks();
    expect(readPendingPayments(key)).toEqual([payment]);
  });

  it("enqueues only after a running flush releases the queue", async () => {
    let release: (() => void) | undefined;
    let tail = Promise.resolve();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        query: async () => ({ held: [], pending: [] }),
        request: (
          _name: string,
          ...rest:
            | [unknown, (lock: unknown) => unknown]
            | [(lock: unknown) => unknown]
        ) => {
          const callback = rest.length === 2 ? rest[1] : rest[0];
          const run = tail.then(() => callback({}));
          tail = run.then(() => undefined);
          return run;
        },
      },
    });
    appendStoredPendingPayment(key, payment);
    const flushing = withPendingPaymentsFlushLock(async () => {
      expect(claimStoredPendingPayment(key, payment.id)).toEqual(payment);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const second = { ...payment, id: "queue-2" };
    const enqueued = enqueueStoredPendingPayment(key, second);
    await Promise.resolve();
    expect(readPendingPayments(key)).toEqual([]);
    release?.();
    await Promise.all([flushing, enqueued]);
    expect(readPendingPayments(key)).toEqual([second]);
  });
});
