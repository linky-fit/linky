import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TokenTransfer } from "@linky-fit/linkshu";
import type { StoredOperation } from "@linky-fit/linkshu";
import {
  createStoredProofFixture,
  createTransferFixture,
} from "../../testUtils/cashuInventory";
import {
  isShownDeferredReceive,
  sentTokenClaims,
  takenTokenTexts,
} from "./cashuTransfers";

const transfer = (
  id: string,
  kind: "send" | "receive",
  status: TokenTransfer["status"],
) =>
  Schema.decodeUnknownSync(TokenTransfer)(
    createTransferFixture({ id, kind, status, tokenText: `cashuB${id}` }),
  );

describe("takenTokenTexts", () => {
  it("counts a deferred token as taken, discarded or not, and leaves an interrupted receive to resume", () => {
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
        "cashuBdiscarded",
      ].sort(),
    );
  });

  it("leaves a text open whose deferral a retry handed over to a receive that failed transiently", () => {
    const tokenText = "cashuBhandedover";
    const handedOver = createTransferFixture({
      id: "BAQEBAQEBAQEBAQEBAQEBA",
      kind: "deferredReceive",
      status: "done",
      tokenText,
    });
    const receive = (error: string) =>
      Schema.decodeUnknownSync(TokenTransfer)(
        createTransferFixture({
          id: "BQUFBQUFBQUFBQUFBQUFBQ",
          kind: "receive",
          status: "failed",
          tokenText,
          error,
        }),
      );

    const unreachable = receive(
      JSON.stringify({ _tag: "MintUnreachable", detail: "fetch failed" }),
    );
    const spent = receive(JSON.stringify({ _tag: "TokenAlreadySpent" }));

    expect(takenTokenTexts([unreachable], [handedOver]).has(tokenText)).toBe(
      false,
    );
    expect(takenTokenTexts([spent], [handedOver]).has(tokenText)).toBe(true);
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

describe("sentTokenClaims", () => {
  const proof = (
    id: string,
    operationId: string,
    state: "handedOut" | "spent",
    amount = 50,
  ) => createStoredProofFixture({ id, operationId, state, amount });

  it("marks an own send claimed once every proof it handed out is spent", () => {
    const claimed = transfer("AQEBAQEBAQEBAQEBAQEBAQ", "send", "done");
    const partial = transfer("AgICAgICAgICAgICAgICAg", "send", "done");
    const returned = transfer("AwMDAwMDAwMDAwMDAwMDAw", "send", "returned");
    const received = transfer("BAQEBAQEBAQEBAQEBAQEBA", "receive", "done");

    const claims = sentTokenClaims(
      [claimed, partial, returned, received],
      [
        proof("BQUFBQUFBQUFBQUFBQUFBQ", claimed.id, "spent"),
        proof("BgYGBgYGBgYGBgYGBgYGBg", claimed.id, "spent"),
        proof("BwcHBwcHBwcHBwcHBwcHBw", partial.id, "spent"),
        proof("CAgICAgICAgICAgICAgICA", partial.id, "handedOut"),
        proof("CQkJCQkJCQkJCQkJCQkJCQ", returned.id, "spent"),
        proof("CgoKCgoKCgoKCgoKCgoKCg", received.id, "spent"),
      ],
    );

    expect([...claims]).toEqual([
      [claimed.tokenText, true],
      [partial.tokenText, false],
      [returned.tokenText, false],
    ]);
  });

  it("keeps a send unclaimed while spent proofs cover only part of its amount", () => {
    const send = transfer("AQEBAQEBAQEBAQEBAQEBAQ", "send", "done");

    const claims = sentTokenClaims(
      [send],
      [proof("BQUFBQUFBQUFBQUFBQUFBQ", send.id, "spent", 20)],
    );

    expect(claims.get(send.tokenText)).toBe(false);
  });
});
