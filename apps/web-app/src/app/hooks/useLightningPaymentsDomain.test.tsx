import {
  Amount,
  InsufficientFunds,
  MeltReceipt,
  MintRejected,
  MintUrl,
  NonNegativeAmount,
  QuoteId,
} from "@linky/linkshu";
import { Either } from "effect";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { MeltCashuInvoice } from "./composition/useLinkshuComposition";
import type { LnurlPayInvoiceResult } from "../../lnurlPay";

const { fetchLnurlInvoiceForTargetMock } = vi.hoisted(() => ({
  fetchLnurlInvoiceForTargetMock:
    vi.fn<
      (target: string, amountSat: number) => Promise<LnurlPayInvoiceResult>
    >(),
}));

vi.mock("../../lnurlPay", () => ({
  fetchLnurlInvoiceForTarget: fetchLnurlInvoiceForTargetMock,
  getLnurlPayDisplayText: (target: string) => target,
  inferLightningAddressFromLnurlTarget: (target: string) =>
    target.includes("@") ? target : null,
}));

import { useLightningPaymentsDomain } from "./useLightningPaymentsDomain";

const MINT_URL = "https://mint.example";

const meltReceipt = (paidAmount: number): MeltReceipt =>
  new MeltReceipt({
    mint: MintUrl.make(MINT_URL),
    quoteId: QuoteId.make("quote-1"),
    paidAmount: Amount.make(paidAmount),
    feeReserve: NonNegativeAmount.make(2),
    feePaid: NonNegativeAmount.make(1),
    changeAmount: NonNegativeAmount.make(1),
  });

const insufficientFunds = (required: number, available: number) =>
  Either.left(
    new InsufficientFunds({
      mint: MintUrl.make(MINT_URL),
      required: Amount.make(required),
      available: NonNegativeAmount.make(available),
    }),
  );

type Payments = ReturnType<typeof useLightningPaymentsDomain>;

interface SetupOptions {
  balance?: number;
  meltCashuInvoice: MeltCashuInvoice;
}

const setup = async ({ balance = 100, meltCashuInvoice }: SetupOptions) => {
  const paymentsRef: { current: Payments | null } = { current: null };
  const logPaymentEvent = vi.fn();
  const setStatus = vi.fn();
  const showPaidOverlay = vi.fn();
  const setPostPaySaveContact = vi.fn();

  const Harness = () => {
    const domain = useLightningPaymentsDomain({
      canPayWithCashu: balance > 0,
      cashuBalance: balance,
      cashuIsBusy: false,
      contacts: [],
      defaultMintUrl: null,
      formatDisplayedAmountParts: (amountSat) => ({
        approxPrefix: "",
        amountText: String(amountSat),
        unitLabel: "sat",
      }),
      logPaymentEvent,
      meltCashuInvoice,
      setCashuIsBusy: vi.fn(),
      setContactsOnboardingHasPaid: vi.fn(),
      setPostPaySaveContact,
      setStatus,
      showPaidOverlay,
      t: (key) => key,
      walletMintBalances: [{ amount: balance, mint: MINT_URL }],
    });

    React.useEffect(() => {
      paymentsRef.current = domain;
    }, [domain]);
    return null;
  };

  const { root } = await renderIntoDocument(<Harness />);
  if (paymentsRef.current === null) {
    throw new Error("payments hook did not mount");
  }
  return {
    logPaymentEvent,
    payments: paymentsRef.current,
    root,
    setPostPaySaveContact,
    setStatus,
    showPaidOverlay,
  };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("payLightningInvoiceWithCashu", () => {
  it("pays through linkshu Melt and records the receipt", async () => {
    const melt = vi.fn<MeltCashuInvoice>(async () =>
      Either.right(meltReceipt(40)),
    );
    const harness = await setup({ meltCashuInvoice: melt });

    const paid =
      await harness.payments.payLightningInvoiceWithCashu("lnbc-mock-invoice");

    expect(paid).toBe(true);
    expect(melt).toHaveBeenCalledWith({
      invoice: "lnbc-mock-invoice",
      mint: MINT_URL,
    });
    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 40,
        fee: 1,
        method: "lightning_invoice",
        mint: MINT_URL,
        phase: "complete",
        status: "ok",
      }),
    );
    expect(harness.showPaidOverlay).toHaveBeenCalled();
    await act(async () => harness.root.unmount());
  });

  it("reports a typed melt failure and leaves no success side effects", async () => {
    const melt = vi.fn<MeltCashuInvoice>(async () =>
      Either.left(
        new MintRejected({
          mint: MintUrl.make(MINT_URL),
          code: null,
          detail: "boom",
        }),
      ),
    );
    const harness = await setup({ meltCashuInvoice: melt });

    const paid =
      await harness.payments.payLightningInvoiceWithCashu("lnbc-mock-invoice");

    expect(paid).toBe(false);
    expect(harness.setStatus).toHaveBeenCalledWith(
      "payFailed: Mint rejected the token: boom",
    );
    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Mint rejected the token: boom",
        phase: "melt",
        status: "error",
      }),
    );
    expect(harness.showPaidOverlay).not.toHaveBeenCalled();
    await act(async () => harness.root.unmount());
  });
});

describe("payLightningAddressWithCashu", () => {
  it("degrades a full-balance amount until the melt fits", async () => {
    fetchLnurlInvoiceForTargetMock.mockImplementation(
      async (_target, amountSat) => ({
        lightningAddress: "alice@example.com",
        pr: `lnbc-mock-${amountSat}`,
        successAction: null,
      }),
    );
    // The mint needs amount + 3 sat of fees; only 97 sat or less fits into
    // the 100 sat balance.
    const melt = vi.fn<MeltCashuInvoice>(async ({ invoice }) => {
      const amount = Number(invoice.replace("lnbc-mock-", ""));
      return amount + 3 > 100
        ? insufficientFunds(amount + 3, 100)
        : Either.right(meltReceipt(amount));
    });
    const harness = await setup({ meltCashuInvoice: melt });

    const paid = await harness.payments.payLightningAddressWithCashu(
      "alice@example.com",
      100,
    );

    expect(paid).toBe(true);
    const attemptedAmounts = fetchLnurlInvoiceForTargetMock.mock.calls.map(
      ([, amountSat]) => amountSat,
    );
    expect(attemptedAmounts).toEqual([100, 99, 98, 97]);
    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 97,
        fee: 1,
        method: "lightning_address",
        phase: "complete",
        status: "ok",
      }),
    );
    await act(async () => harness.root.unmount());
  });

  it("stops on a non-retryable melt failure and logs the melt phase", async () => {
    fetchLnurlInvoiceForTargetMock.mockImplementation(
      async (_target, amountSat) => ({
        lightningAddress: "alice@example.com",
        pr: `lnbc-mock-${amountSat}`,
        successAction: null,
      }),
    );
    const melt = vi.fn<MeltCashuInvoice>(async () =>
      Either.left(
        new MintRejected({
          mint: MintUrl.make(MINT_URL),
          code: null,
          detail: "melt disabled",
        }),
      ),
    );
    const harness = await setup({ meltCashuInvoice: melt });

    const paid = await harness.payments.payLightningAddressWithCashu(
      "alice@example.com",
      40,
    );

    expect(paid).toBe(false);
    expect(melt).toHaveBeenCalledTimes(1);
    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Mint rejected the token: melt disabled",
        method: "lightning_address",
        mint: MINT_URL,
        phase: "melt",
        status: "error",
      }),
    );
    await act(async () => harness.root.unmount());
  });
});
