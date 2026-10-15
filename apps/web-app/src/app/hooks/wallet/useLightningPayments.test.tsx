import {
  Amount,
  MeltReceipt,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  PaymentPending,
  QuoteId,
} from "@linky-fit/linkshu";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type {
  PayInvoiceOutcome,
  PayLightningAddressOutcome,
  PaymentsCommands,
} from "../../state/wallet/payments";
import type { Route } from "../../../types/route";
import { useLightningPayments } from "./useLightningPayments";

const { commandsRef, navigateTo } = vi.hoisted(() => {
  const commandsRef: { current: PaymentsCommands | null } = { current: null };
  return { commandsRef, navigateTo: vi.fn() };
});
vi.mock("../../../hooks/useRouting", () => ({ navigateTo }));
vi.mock("./paymentUi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./paymentUi")>()),
  usePaymentsCommands: () => commandsRef.current,
}));

const receipt = new MeltReceipt({
  mint: MintUrl.make("https://mint.example"),
  quoteId: QuoteId.make("quote-1"),
  paidAmount: Amount.make(40),
  feeReserve: NonNegativeAmount.make(2),
  feePaid: NonNegativeAmount.make(1),
  changeAmount: NonNegativeAmount.make(1),
});

const pending = new PaymentPending({
  mint: MintUrl.make("https://mint.example"),
  quoteId: QuoteId.make("quote-1"),
  operationId: OperationId.make("op-1"),
  amount: Amount.make(40),
});

const commandsAnswering = ({
  invoice = { _tag: "Paid", receipt },
  address = {
    _tag: "Paid",
    receipt,
    lightningAddress: "alice@example.com",
    successAction: null,
  },
}: {
  invoice?: PayInvoiceOutcome;
  address?: PayLightningAddressOutcome;
}) => {
  commandsRef.current = {
    fundsFor: vi.fn(),
    payContact: vi.fn(),
    payLightningAddress: vi.fn(async (_args, options) => {
      options?.onSending?.();
      return address;
    }),
    payLightningInvoice: vi.fn(async (_invoice, options) => {
      options?.onSending?.();
      return invoice;
    }),
    payPaymentRequest: vi.fn(),
    quotePaymentRequest: vi.fn(),
  };
};

const render = async (routeKind: Route["kind"] = "manualPay") => {
  const ui = {
    dismissPaymentSending: vi.fn(),
    rememberFirstPayment: vi.fn(),
    reportShortfall: vi.fn(),
    setStatus: vi.fn(),
    showPaidOverlay: vi.fn(),
    showPaymentSending: vi.fn(),
  };
  const hook: { current: ReturnType<typeof useLightningPayments> | null } = {
    current: null,
  };
  const Probe = () => {
    const payments = useLightningPayments({
      ...ui,
      formatDisplayedAmountParts: (amount) => ({
        approxPrefix: "",
        amountText: String(amount),
        unitLabel: "sat",
      }),
      routeKind,
      t: (key) => key,
    });
    useEffect(() => {
      hook.current = payments;
    }, [payments]);
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  const current = () => {
    if (hook.current === null) throw new Error("hook not rendered");
    return hook.current;
  };
  return { ...ui, current, view };
};

afterEach(() => {
  commandsRef.current = null;
  vi.clearAllMocks();
});

describe("useLightningPayments", () => {
  it("shows a paid invoice and returns to the wallet from manual pay", async () => {
    commandsAnswering({});
    const ui = await render();

    expect(
      await act(() => ui.current().payLightningInvoiceWithCashu("lnbc")),
    ).toBe(true);
    expect(ui.showPaymentSending).toHaveBeenCalled();
    expect(ui.showPaidOverlay).toHaveBeenCalledWith("paidSent", {
      direction: "out",
      amountSat: 40,
    });
    expect(ui.rememberFirstPayment).toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith({ route: "wallet" });
    await ui.view.unmount();
  });

  it.each<[PayInvoiceOutcome, string | null, boolean]>([
    [{ _tag: "Pending", pending }, "payPending", true],
    [{ _tag: "Failed", detail: "boom" }, "payFailed: boom", false],
    [{ _tag: "NetworkError" }, "payNetworkError", false],
    [{ _tag: "Busy" }, null, false],
  ])("maps %o to its status", async (invoice, status, paid) => {
    commandsAnswering({ invoice });
    const ui = await render("wallet");

    expect(
      await act(() => ui.current().payLightningInvoiceWithCashu("lnbc")),
    ).toBe(paid);
    if (status === null) expect(ui.setStatus).not.toHaveBeenCalled();
    else expect(ui.setStatus).toHaveBeenCalledWith(status);
    expect(ui.dismissPaymentSending).toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    await ui.view.unmount();
  });

  it("hands a shortfall to the mint move confirmation", async () => {
    const shortfall = {
      _tag: "NeedsMintMove",
      fromMint: MintUrl.make("https://foreign.example"),
      toMint: MintUrl.make("https://mint.example"),
    } as const;
    commandsAnswering({ invoice: shortfall });
    const ui = await render();

    await act(() => ui.current().payLightningInvoiceWithCashu("lnbc"));

    expect(ui.reportShortfall).toHaveBeenCalledWith(shortfall);
    await ui.view.unmount();
  });

  it("shows a paid address, its success message and offers to save it", async () => {
    commandsAnswering({
      address: {
        _tag: "Paid",
        receipt,
        lightningAddress: "alice@example.com",
        successAction: { tag: "message", message: "thanks" },
      },
    });
    const ui = await render("lnAddressPay");

    await act(() =>
      ui.current().payLightningAddressWithCashu("alice@example.com", 40),
    );

    expect(ui.showPaidOverlay).toHaveBeenCalledWith(
      "paidSentTo",
      expect.objectContaining({ amountSat: 40 }),
    );
    expect(ui.setStatus).toHaveBeenCalledWith("lnurlSuccessActionMessage");
    expect(ui.current().postPaySaveContact).toEqual({
      lnAddress: "alice@example.com",
      amountSat: 40,
    });
    expect(navigateTo).toHaveBeenCalledWith({ route: "wallet" });
    await ui.view.unmount();
  });

  it("refuses an invalid address amount", async () => {
    commandsAnswering({ address: { _tag: "InvalidAmount" } });
    const ui = await render("lnAddressPay");

    await act(() =>
      ui.current().payLightningAddressWithCashu("alice@example.com", 0),
    );

    expect(ui.setStatus).toHaveBeenCalledWith("errorPrefix: payInvalidAmount");
    expect(navigateTo).not.toHaveBeenCalled();
    await ui.view.unmount();
  });
});
