import { bech32 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { getPayableLightningInvoice } from "./payable";

const invoice =
  "lnbc20u1pvjluezhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqfppqw508d6qejxtdg4y5r3zarvary0c5xw7kxqrrsssp5m6kmam774klwlh4dhmhaatd7al02m0h0m6kmam774klwlh4dhmhs9qypqqqcqpf3cwux5979a8j28d4ydwahx00saa68wq3az7v9jdgzkghtxnkf3z5t7q5suyq2dl9tqwsap8j0wptc82cpyvey9gf6zyylzrm60qtcqsq7egtsq";
const decoded = bech32.decodeUnsafe(invoice, 5000);
if (!decoded) throw new Error("Invalid test invoice");
const withAmount = (amount: string) =>
  bech32.encode(`lnbc${amount}`, decoded.words, 5000);

describe("fixed-amount invoice decoding", () => {
  it("reads whole millisatoshis as sats and derives absolute expiry", () => {
    expect(getPayableLightningInvoice(invoice)).toMatchObject({
      amountSat: 2000,
      expiresAtSec: 1496318258,
    });
    expect(getPayableLightningInvoice(withAmount("10p"))?.amountSat).toBe(1);
    expect(getPayableLightningInvoice(withAmount("10010p"))?.amountSat).toBe(2);
  });
  it.each([
    "lnbc20u1invalid",
    withAmount(""),
    withAmount("0"),
    withAmount("1p"),
    "lnbc" + "q".repeat(5000),
    invoice.slice(0, -1) + "p",
  ])(
    "rejects malformed, amountless, zero, fractional-msat, oversized or corrupt invoice",
    (value) => {
      expect(getPayableLightningInvoice(value)).toBeNull();
    },
  );
});
