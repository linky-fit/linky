import { transactionIdForOperation } from "@linky-fit/linksync";
import { Either, Schema } from "effect";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  MintUrl,
  ReceiveReceipt,
  TokenAlreadySpent,
  TokenTransfer,
} from "@linky-fit/linkshu";
import { createTransferFixture } from "../../../testUtils/cashuInventory";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { Translate } from "../../../i18n";
import type { ReceiveCashuToken } from "../composition/useLinkshuComposition";
import { useCashuDomain } from "../useCashuDomain";
import { useSaveCashuFromText } from "./useSaveCashuFromText";

type SaveCashuFromText = ReturnType<typeof useSaveCashuFromText>;

const translateToKey: Translate = (key) => key;

const setup = async (
  receiveCashuToken: ReceiveCashuToken,
  cashuTransfers: readonly TokenTransfer[] = [],
) => {
  const ref: { current: SaveCashuFromText | null } = { current: null };
  const logPaymentEvent = vi.fn();
  const setStatus = vi.fn();

  const Probe = (): null => {
    const cashu = useCashuDomain({ cashuTransfers, walletLoaded: true });
    const save = useSaveCashuFromText({
      allowTestMints: true,
      enqueueCashuOp: async (op) => {
        await op();
      },
      formatDisplayedAmountParts: () => ({
        amountText: "0",
        approxPrefix: "",
        unitLabel: "sat",
      }),
      isCashuTokenStored: cashu.isCashuTokenStored,
      isMintDeleted: () => false,
      logPaymentEvent,
      mintInfoByUrl: new Map(),
      receiveCashuToken,
      refreshMintInfo: async () => undefined,
      rememberCashuTokenKnown: cashu.rememberCashuTokenKnown,
      setCashuDraft: () => undefined,
      setCashuIsBusy: () => undefined,
      setStatus,
      showPaidOverlay: () => undefined,
      t: translateToKey,
      touchMintInfo: () => undefined,
    });
    React.useEffect(() => {
      ref.current = save;
    }, [save]);
    return null;
  };

  await renderIntoDocument(<Probe />);
  if (!ref.current) throw new Error("hook did not render");
  return { save: ref.current, logPaymentEvent, setStatus };
};

const receiveTransfer = (status: "pending" | "done") =>
  Schema.decodeUnknownSync(TokenTransfer)(
    createTransferFixture({ kind: "receive", status }),
  );

describe("useSaveCashuFromText", () => {
  it("resolves terminally when the mint reports the token already spent", async () => {
    const { save } = await setup(async () =>
      Either.left(
        new TokenAlreadySpent({ mint: MintUrl.make("https://x.cz") }),
      ),
    );
    const onResolved = vi.fn();

    await save("cashuBspenttoken", { onResolved });

    // Lets the message-driven auto-accept stop retrying the dead token; its
    // in-session dedup resets on reload.
    expect(onResolved).toHaveBeenCalledWith("terminal");
  });

  it("resolves transiently on an unexpected receive failure", async () => {
    const { save } = await setup(async () => {
      throw new Error("mint unreachable");
    });
    const onResolved = vi.fn();

    await save("cashuBtransient", { onResolved });

    expect(onResolved).toHaveBeenCalledWith("transient");
  });

  it("resumes a receive a reload left pending and records it in history", async () => {
    const transfer = receiveTransfer("pending");
    const receive = vi.fn<ReceiveCashuToken>(async () =>
      Either.right(
        new ReceiveReceipt({
          operationId: transfer.id,
          tokenText: transfer.tokenText,
          mint: transfer.mint,
          unit: transfer.unit,
          amount: transfer.amount,
        }),
      ),
    );
    const { save, logPaymentEvent } = await setup(receive, [transfer]);

    await save(transfer.tokenText);

    expect(receive).toHaveBeenCalledWith(transfer.tokenText);
    expect(logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ok",
        transactionId: transactionIdForOperation(transfer.id),
      }),
    );
  });

  it("reports a finished receive as already saved without receiving again", async () => {
    const transfer = receiveTransfer("done");
    const receive = vi.fn<ReceiveCashuToken>();
    const { save, setStatus } = await setup(receive, [transfer]);
    const onResolved = vi.fn();

    await save(transfer.tokenText, { onResolved });

    expect(setStatus).toHaveBeenCalledWith("cashuExists");
    expect(receive).not.toHaveBeenCalled();
    expect(onResolved).toHaveBeenCalledWith("terminal");
  });
});
