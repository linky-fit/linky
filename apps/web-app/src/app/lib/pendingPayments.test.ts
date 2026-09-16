import { makeIdentity } from "@linky/linkstr/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  safeLocalStorageRemove,
  safeLocalStorageSetJson,
} from "../../utils/storage";
import { readPendingPayments } from "./pendingPayments";

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
