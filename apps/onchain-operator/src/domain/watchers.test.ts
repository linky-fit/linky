import { createId } from "@linky-fit/domain";
import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import type { OperatorTransfer } from "./transfer";
import { MAX_WATCHERS, parseWatchers, watcherAlertText } from "./watchers";

const user = makeIdentity().pubkey;

const transfer: OperatorTransfer = {
  id: createId<"OnchainTransfer">(),
  createdAtSec: 1_700_000_000,
  user,
  direction: "send",
  amount: 100_000,
  feeBasisPoints: 100,
  payoutAddress: "bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk",
  refund: null,
  userPaymentRequest: null,
  operatorPaymentRequest: null,
  depositAddress: null,
  addressIndex: null,
  update: null,
  userCancelledAtSec: null,
};

describe("parseWatchers", () => {
  it("reads npubs separated by lines, commas or spaces, without repeats", () => {
    const [a, b] = [makeIdentity().pubkey, makeIdentity().pubkey];
    expect(
      parseWatchers(`${encodeNpub(a)}\n ${encodeNpub(b)}, ${encodeNpub(a)}`),
    ).toEqual([a, b]);
    expect(parseWatchers("  ")).toEqual([]);
  });

  it("rejects anything that is no npub, and too many", () => {
    expect(parseWatchers("npub1nope")).toBeNull();
    expect(parseWatchers(user)).toBeNull();
    expect(
      parseWatchers(
        Array.from({ length: MAX_WATCHERS + 1 }, () =>
          encodeNpub(makeIdentity().pubkey),
        ).join("\n"),
      ),
    ).toBeNull();
  });
});

describe("watcherAlertText", () => {
  it("says what waits for the operator", () => {
    expect(watcherAlertText({ _tag: "requested", transfer }, "Alice")).toBe(
      "On-chain operator: Alice requests an on-chain send of 100 000 sat. Accept or deny it in the operator console.",
    );
    expect(
      watcherAlertText({ _tag: "payoutDue", transfer }, "Alice"),
    ).toContain("Pay 100 000 sat");
    const receive: OperatorTransfer = { ...transfer, direction: "receive" };
    expect(
      watcherAlertText(
        { _tag: "ecashDue", transfer: receive, receivedAmount: 101_000 },
        "Alice",
      ),
    ).toContain("Send them the Cashu.");
    expect(
      watcherAlertText(
        { _tag: "ecashDue", transfer: receive, receivedAmount: 100_000 },
        "Alice",
      ),
    ).toContain("short (100 000 sat)");
  });

  it("quotes a long message in part", () => {
    const text = watcherAlertText(
      { _tag: "message", from: user, text: ` ${"a".repeat(300)} ` },
      "Alice",
    );
    expect(text).toBe(`On-chain operator: Alice wrote: "${"a".repeat(200)}…"`);
  });
});
