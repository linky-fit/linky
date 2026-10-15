import { TokenTransfer } from "@linky-fit/linkshu";
import { Result, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encodeBase64Url } from "../../../utils/base64";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { CashuTransferLifecycle } from "../../state/linkshu/commands";
import type { LocalNostrMessage } from "../../types/appTypes";
import { useTransferCleanup } from "./useTransferCleanup";

const MINT = "https://mint.example";
const proof = {
  id: "009a1f293253e41e",
  amount: 21,
  secret: "send-secret",
  C: `02${"cd".repeat(32)}`,
};
const tokenText = `cashuA${encodeBase64Url(
  new TextEncoder().encode(
    JSON.stringify({ token: [{ mint: MINT, proofs: [proof] }], unit: "sat" }),
  ),
)}`;
const payloadText = JSON.stringify({
  id: "pay-1",
  mint: MINT,
  unit: "sat",
  proofs: [proof],
});

const pendingSend = Schema.decodeUnknownSync(TokenTransfer)({
  id: "send-op",
  kind: "send",
  status: "pending",
  tokenText,
  amount: 21,
  mint: MINT,
  unit: "sat",
  error: null,
  createdAt: 1,
});

const outgoing = (
  content: string,
  status: "sent" | "pending",
): LocalNostrMessage => ({
  contactId: "contact-1",
  content,
  createdAtSec: 2,
  direction: "out",
  id: "message-1",
  pubkey: "me",
  rumorId: "rumor-1",
  status,
  wrapId: "wrap-1",
});

const lifecycleFake = () => {
  const forget = vi.fn(async () => Result.succeed(undefined));
  const lifecycle: CashuTransferLifecycle = {
    reclaim: vi.fn(),
    checkIssuedClaims: vi.fn(),
    forget,
    importLegacyRows: vi.fn(),
    importOperation: vi.fn(),
    importProofs: vi.fn(),
    markExternalized: vi.fn(),
    markIssued: vi.fn(),
    returnToWallet: vi.fn(),
  };
  return { forget, lifecycle };
};

const Harness = ({
  lifecycle,
  messages,
}: {
  lifecycle: CashuTransferLifecycle;
  messages: LocalNostrMessage[];
}) => {
  useTransferCleanup({
    chatMessages: [],
    contacts: [],
    currentNpub: null,
    lifecycle,
    nostrMessagesLocal: messages,
    nostrMessagesRecent: [],
    walletTransfers: [pendingSend],
  });
  return null;
};

describe("useTransferCleanup", () => {
  it.each([
    ["the token itself", tokenText],
    ["the NUT-18 payload carrying its proofs", payloadText],
  ])("closes a pending send once %s is sent", async (_, content) => {
    const { forget, lifecycle } = lifecycleFake();
    const { unmount } = await renderIntoDocument(
      <Harness lifecycle={lifecycle} messages={[outgoing(content, "sent")]} />,
    );
    expect(forget).toHaveBeenCalledWith("send-op");
    await unmount();
  });

  it("keeps the send while its message is still pending", async () => {
    const { forget, lifecycle } = lifecycleFake();
    const { unmount } = await renderIntoDocument(
      <Harness
        lifecycle={lifecycle}
        messages={[outgoing(payloadText, "pending")]}
      />,
    );
    expect(forget).not.toHaveBeenCalled();
    await unmount();
  });
});
