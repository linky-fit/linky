import { transactionIdForOperation } from "@linky-fit/linksync";
import { Either, Schema } from "effect";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CounterLockTimeout,
  CurrencyUnit,
  KeysetId,
  MintUrl,
  ReceiveReceipt,
  TokenAlreadySpent,
  TokenParseFailed,
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
  const setStatus = vi.fn();
  const setCashuDraft = vi.fn();
  const logPaymentEvent = vi.fn();

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
      setCashuDraft,
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
  return { save: ref.current, setStatus, setCashuDraft, logPaymentEvent };
};

const receiveTransfer = (status: "pending" | "done") =>
  Schema.decodeUnknownSync(TokenTransfer)(
    createTransferFixture({ kind: "receive", status }),
  );

const mint = MintUrl.make("https://x.cz");

const alreadySpent: ReceiveCashuToken = async () =>
  Either.left(new TokenAlreadySpent({ mint }));

describe("useSaveCashuFromText", () => {
  it("resolves terminally when the mint reports the token already spent", async () => {
    const { save } = await setup(alreadySpent);
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

  it("reports a spent token the user pasted", async () => {
    const { save, setStatus, logPaymentEvent } = await setup(alreadySpent);

    await save("cashuBspenttoken");

    expect(setStatus).toHaveBeenCalledWith("cashuAccepting");
    expect(setStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("cashuAcceptFailed"),
    );
    expect(logPaymentEvent).toHaveBeenCalledOnce();
  });

  it("stays silent on a spent token an automatic receive found in history", async () => {
    const { save, setStatus, logPaymentEvent } = await setup(alreadySpent);
    const onResolved = vi.fn();

    await save("cashuBspenttoken", { automatic: true, onResolved });

    expect(onResolved).toHaveBeenCalledWith("terminal");
    expect(setStatus).not.toHaveBeenCalled();
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("keeps the paste draft for an automatic receive", async () => {
    const { save, setCashuDraft } = await setup(alreadySpent);

    await save("cashuBspenttoken", { automatic: true });

    expect(setCashuDraft).not.toHaveBeenCalled();
  });

  it("stays silent on an automatic receive that throws", async () => {
    const { save, setStatus, logPaymentEvent } = await setup(async () => {
      throw new Error("mint unreachable");
    });
    const onResolved = vi.fn();

    await save("cashuBtransient", { automatic: true, onResolved });

    expect(onResolved).toHaveBeenCalledWith("transient");
    expect(setStatus).not.toHaveBeenCalled();
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("logs no history failure for an automatic receive that will be retried", async () => {
    const { save, logPaymentEvent } = await setup(async () =>
      Either.left(
        new CounterLockTimeout({
          mint,
          unit: CurrencyUnit.make("sat"),
          keysetId: KeysetId.make("009a1f293253e41e"),
        }),
      ),
    );
    const onResolved = vi.fn();

    await save("cashuBlocked", { automatic: true, onResolved });

    expect(onResolved).toHaveBeenCalledWith("transient");
    expect(logPaymentEvent).not.toHaveBeenCalled();
  });

  it("logs a terminal failure of an automatic receive", async () => {
    const { save, setStatus, logPaymentEvent } = await setup(async () =>
      Either.left(
        new TokenParseFailed({ reason: "undecodable", detail: null }),
      ),
    );

    await save("cashuBbroken", { automatic: true });

    expect(setStatus).not.toHaveBeenCalled();
    expect(logPaymentEvent).toHaveBeenCalledOnce();
  });
});
