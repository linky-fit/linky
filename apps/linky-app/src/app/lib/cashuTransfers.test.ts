import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TokenTransfer } from "@linky-fit/linkshu";
import type { StoredOperation } from "@linky-fit/linkshu";
import {
  createStoredProofFixture,
  createTransferFixture,
} from "../../testUtils/cashuInventory";
import {
  buildCashuToken,
  reencodeCashuToken,
} from "../../testUtils/cashuToken";
import {
  isShownDeferredReceive,
  receivedTokenProofs,
  sentTokenClaims,
  takenTokenProofs,
} from "./cashuTransfers";
import { getCashuTokenMessageInfo } from "./tokenMessageInfo";
import { tokenProofsKey } from "./tokenText";

const tokenOf = (name: string) => buildCashuToken({ secretPrefix: name });
const keyOf = (name: string) => tokenProofsKey(tokenOf(name));

const transfer = (
  id: string,
  kind: "send" | "receive",
  status: TokenTransfer["status"],
) =>
  Schema.decodeUnknownSync(TokenTransfer)(
    createTransferFixture({ id, kind, status, tokenText: tokenOf(id) }),
  );

describe("takenTokenProofs", () => {
  it("counts a deferred token as taken, discarded or not, and leaves an interrupted receive to resume", () => {
    const taken = takenTokenProofs(
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
          tokenText: tokenOf("deferred"),
        }),
        createTransferFixture({
          id: "BQUFBQUFBQUFBQUFBQUFBQ",
          kind: "deferredReceive",
          status: "done",
          tokenText: tokenOf("discarded"),
        }),
      ],
    );

    expect([...taken].sort()).toEqual(
      [
        keyOf("AQEBAQEBAQEBAQEBAQEBAQ"),
        keyOf("AgICAgICAgICAgICAgICAg"),
        keyOf("deferred"),
        keyOf("discarded"),
      ].sort(),
    );
  });

  it("leaves a token open whose deferral a retry handed over to a receive that failed transiently", () => {
    const tokenText = tokenOf("handedover");
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

    const key = keyOf("handedover") ?? "";
    expect(takenTokenProofs([unreachable], [handedOver]).has(key)).toBe(false);
    expect(takenTokenProofs([spent], [handedOver]).has(key)).toBe(true);
  });
});

describe("isShownDeferredReceive", () => {
  const deferral = (status: StoredOperation["status"], unit: string) =>
    createTransferFixture({
      id: "BAQEBAQEBAQEBAQEBAQEBA",
      kind: "deferredReceive",
      status,
      tokenText: tokenOf("deferred"),
      unit,
    });

  it("shows only pending sat deferrals, whose amounts the wallet sums as sat", () => {
    expect(isShownDeferredReceive(deferral("pending", "sat"))).toBe(true);
    expect(isShownDeferredReceive(deferral("pending", "usd"))).toBe(false);
    expect(isShownDeferredReceive(deferral("done", "sat"))).toBe(false);
  });
});

describe("receivedTokenProofs", () => {
  it("holds only receives that completed", () => {
    const done = transfer("AQEBAQEBAQEBAQEBAQEBAQ", "receive", "done");
    const failed = transfer("AgICAgICAgICAgICAgICAg", "receive", "failed");
    const pending = transfer("AwMDAwMDAwMDAwMDAwMDAw", "receive", "pending");
    const sent = transfer("BAQEBAQEBAQEBAQEBAQEBA", "send", "done");

    expect([...receivedTokenProofs([done, failed, pending, sent])]).toEqual([
      tokenProofsKey(done.tokenText),
    ]);
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
      [tokenProofsKey(claimed.tokenText), true],
      [tokenProofsKey(partial.tokenText), false],
      [tokenProofsKey(returned.tokenText), false],
    ]);
  });

  it("keeps a send unclaimed while spent proofs cover only part of its amount", () => {
    const send = transfer("AQEBAQEBAQEBAQEBAQEBAQ", "send", "done");

    const claims = sentTokenClaims(
      [send],
      [proof("BQUFBQUFBQUFBQUFBQUFBQ", send.id, "spent", 20)],
    );

    expect(claims.get(tokenProofsKey(send.tokenText) ?? "")).toBe(false);
  });

  it("finds a send by its proofs whether the message carries it as v4 text or a NUT-18 payload", () => {
    const token = tokenOf("paid");
    const { payload, v4 } = reencodeCashuToken(token);
    const send = Schema.decodeUnknownSync(TokenTransfer)(
      createTransferFixture({
        id: "AQEBAQEBAQEBAQEBAQEBAQ",
        kind: "send",
        status: "done",
        tokenText: v4,
      }),
    );

    const claims = sentTokenClaims(
      [send],
      [proof("BQUFBQUFBQUFBQUFBQUFBQ", send.id, "spent", send.amount)],
    );

    expect(
      getCashuTokenMessageInfo(payload, new Set(), true, claims)?.sent,
    ).toBe("claimed");
    expect(
      getCashuTokenMessageInfo(payload, takenTokenProofs([send], []))?.isValid,
    ).toBe(false);
  });
});
