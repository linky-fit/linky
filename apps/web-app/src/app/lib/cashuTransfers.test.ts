import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TokenTransfer } from "@linky-fit/linkshu";
import type { StoredOperation } from "@linky-fit/linkshu";
import { createTransferFixture } from "../../testUtils/cashuInventory";
import { isShownDeferredReceive, takenTokenTexts } from "./cashuTransfers";

const transfer = (
  id: string,
  kind: "send" | "receive",
  status: TokenTransfer["status"],
) =>
  Schema.decodeUnknownSync(TokenTransfer)(
    createTransferFixture({ id, kind, status, tokenText: `cashuB${id}` }),
  );

describe("takenTokenTexts", () => {
  it("counts a deferred token as taken and leaves an interrupted receive to resume", () => {
    const taken = takenTokenTexts(
      [
        transfer("AQEBAQEBAQEBAQEBAQEBAQ", "send", "issued"),
        transfer("AgICAgICAgICAgICAgICAg", "receive", "done"),
        transfer("AwMDAwMDAwMDAwMDAwMDAw", "receive", "pending"),
      ],
      [
        createTransferFixture({
          id: "BAQEBAQEBAQEBAQEBAQEBA",
          kind: "deferredReceive",
          status: "pending",
          tokenText: "cashuBdeferred",
        }),
        createTransferFixture({
          id: "BQUFBQUFBQUFBQUFBQUFBQ",
          kind: "deferredReceive",
          status: "done",
          tokenText: "cashuBdiscarded",
        }),
      ],
    );

    expect([...taken].sort()).toEqual(
      [
        "cashuBAQEBAQEBAQEBAQEBAQEBAQ",
        "cashuBAgICAgICAgICAgICAgICAg",
        "cashuBdeferred",
      ].sort(),
    );
  });
});

describe("isShownDeferredReceive", () => {
  const deferral = (status: StoredOperation["status"], unit: string) =>
    createTransferFixture({
      id: "BAQEBAQEBAQEBAQEBAQEBA",
      kind: "deferredReceive",
      status,
      tokenText: "cashuBdeferred",
      unit,
    });

  it("shows only pending sat deferrals, whose amounts the wallet sums as sat", () => {
    expect(isShownDeferredReceive(deferral("pending", "sat"))).toBe(true);
    expect(isShownDeferredReceive(deferral("pending", "usd"))).toBe(false);
    expect(isShownDeferredReceive(deferral("done", "sat"))).toBe(false);
  });
});
