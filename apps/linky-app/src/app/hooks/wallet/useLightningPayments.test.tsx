import {
  Amount,
  MeltReceipt,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  PaymentPending,
  QuoteId,
} from "@linky-fit/linkshu";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import {
  lightningInvoiceQuoteAtom,
  type LightningInvoiceQuoteState,
} from "../../state/shell/confirmations";
import type {
  PayInvoiceOutcome,
  PayLightningAddressOutcome,
  PaymentsCommands,
  QuoteLightningInvoiceOutcome,
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
  quote = {
    _tag: "Quoted",
    amount: 40,
    fee: 3,
    mint: MintUrl.make("https://mint.example"),
  },
}: {
  invoice?: PayInvoiceOutcome;
  address?: PayLightningAddressOutcome;
  quote?: QuoteLightningInvoiceOutcome;
}) => {
  commandsRef.current = {
    fundsFor: vi.fn(),
    payContact: vi.fn(),
    quoteLightningInvoice: vi.fn(async () => quote),
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
  const quotes: Array<LightningInvoiceQuoteState | null> = [];
  const Probe = () => {
    quotes.push(useAtomValue(lightningInvoiceQuoteAtom));
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
  return { ...ui, current, quotes, view };
};

afterEach(() => {
  commandsRef.current = null;
  vi.clearAllMocks();
});

describe("useLightningPayments", () => {
  it("prices an invoice waiting for confirmation and drops the estimate with it", async () => {
    commandsAnswering({});
    const ui = await render();
    const preview = {
      invoice: "lnbc-mock",
      amountSat: 40,
      description: null,
      expiresAtSec: null,
    };

    await act(async () => {
      ui.current().setPendingLightningInvoiceConfirmation(preview);
    });
    expect(commandsRef.current?.quoteLightningInvoice).toHaveBeenCalledWith(
      "lnbc-mock",
    );
    expect(ui.quotes).toContainEqual({
      invoice: "lnbc-mock",
      outcome: "pending",
    });
    expect(ui.quotes.at(-1)).toEqual({
      invoice: "lnbc-mock",
      outcome: {
        _tag: "Quoted",
        amount: 40,
        fee: 3,
        mint: "https://mint.example",
      },
    });

    await act(async () => {
      ui.current().closeLightningInvoiceConfirmation();
    });
    expect(ui.quotes.at(-1)).toBeNull();
    await ui.view.unmount();
  });

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
