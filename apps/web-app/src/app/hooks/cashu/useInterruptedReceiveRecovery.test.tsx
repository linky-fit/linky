import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DecodedToken, encodeToken, TokenTransfer } from "@linky-fit/linkshu";
import { createTransferFixture } from "../../../testUtils/cashuInventory";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { LocalNostrMessage } from "../../types/appTypes";
import { useInterruptedReceiveRecovery } from "./useInterruptedReceiveRecovery";

const transfer = (
  id: string,
  kind: "send" | "receive",
  status: TokenTransfer["status"],
  error: string | null = null,
) =>
  Schema.decodeUnknownSync(TokenTransfer)(
    createTransferFixture({
      id,
      kind,
      status,
      error,
      tokenText: encodeToken(
        Schema.decodeUnknownSync(DecodedToken)({
          mint: "https://mint.example",
          unit: "sat",
          memo: null,
          proofs: [
            {
              id: "009a1f293253e41e",
              amount: 8,
              secret: id,
              C: "02" + "ab".repeat(32),
            },
          ],
        }),
      ),
    }),
  );

const incoming = (content: string): LocalNostrMessage => ({
  contactId: "contact",
  content,
  createdAtSec: 1,
  direction: "in",
  id: "message",
  pubkey: "pubkey",
  rumorId: null,
  wrapId: "wrap",
});

const interrupted = transfer("AQEBAQEBAQEBAQEBAQEBAQ", "receive", "pending");
const fromChat = transfer("AgICAgICAgICAgICAgICAg", "receive", "pending");
const unreachable = transfer(
  "BgYGBgYGBgYGBgYGBgYGBg",
  "receive",
  "failed",
  JSON.stringify({ _tag: "MintUnreachable", mint: "https://mint.example" }),
);
const cashuTransfers = [
  interrupted,
  fromChat,
  unreachable,
  transfer("AwMDAwMDAwMDAwMDAwMDAw", "receive", "done"),
  transfer(
    "BAQEBAQEBAQEBAQEBAQEBA",
    "receive",
    "failed",
    JSON.stringify({ _tag: "TokenAlreadySpent", mint: "https://mint.example" }),
  ),
  transfer("BQUFBQUFBQUFBQUFBQUFBQ", "send", "pending"),
];

describe("useInterruptedReceiveRecovery", () => {
  it("resumes interrupted receives once ready, leaving message-borne tokens to chat", async () => {
    const saveCashuFromText = vi.fn(async () => undefined);
    const Probe = ({ ready }: { ready: boolean }): null => {
      useInterruptedReceiveRecovery({
        cashuTransfers,
        messages: [incoming(`thanks for lunch ${fromChat.tokenText}`)],
        ready,
        saveCashuFromText,
      });
      return null;
    };

    const rendered = await renderIntoDocument(<Probe ready={false} />);
    expect(saveCashuFromText).not.toHaveBeenCalled();

    await rendered.rerender(<Probe ready />);
    await rendered.rerender(<Probe ready />);

    expect(saveCashuFromText.mock.calls).toEqual([
      [interrupted.tokenText],
      [unreachable.tokenText],
    ]);
  });
});
