import { createIdFromString } from "@linky-fit/linksync";
import {
  Amount,
  CurrencyUnit,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  SendReceipt,
  TokenText,
} from "@linky-fit/linkshu";
import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type {
  PayContactOutcome,
  PaymentsCommands,
} from "../../state/wallet/payments";
import { useContactPayments } from "./useContactPayments";

const { commandsRef, navigateTo } = vi.hoisted(() => {
  const commandsRef: { current: PaymentsCommands | null } = { current: null };
  return { commandsRef, navigateTo: vi.fn() };
});
vi.mock("../../../hooks/useRouting", () => ({ navigateTo }));
vi.mock("./paymentUi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./paymentUi")>()),
  usePaymentsCommands: () => commandsRef.current,
}));

const CONTACT_ID = createIdFromString<"Contact">("contact");
const contact = { id: CONTACT_ID, name: "Alice", npub: "npub1alice" };

const receipt = new SendReceipt({
  operationId: OperationId.make("send-op"),
  tokenText: TokenText.make("cashuBtoken"),
  proofs: [],
  mint: MintUrl.make("https://mint.example"),
  unit: CurrencyUnit.make("sat"),
  amount: Amount.make(600),
  lockTo: null,
  changeAmount: NonNegativeAmount.make(0),
  feePaid: NonNegativeAmount.make(0),
});

const commandsPaying = (outcome: PayContactOutcome) => {
  const payContact = vi.fn<PaymentsCommands["payContact"]>(
    async (_payment, options) => {
      options?.onSending?.();
      return outcome;
    },
  );
  commandsRef.current = {
    fundsFor: vi.fn(async () => ({ _tag: "Covered" }) as const),
    payContact,
    payLightningAddress: vi.fn(),
    payLightningInvoice: vi.fn(),
    payPaymentRequest: vi.fn(),
    quoteLightningInvoice: vi.fn(),
    quotePaymentRequest: vi.fn(),
  };
  return payContact;
};

const render = async () => {
  const ui = {
    dismissPaymentSending: vi.fn(),
    pushToast: vi.fn(),
    rememberFirstPayment: vi.fn(),
    reportShortfall: vi.fn(),
    setStatus: vi.fn(),
    showPaidOverlay: vi.fn(),
    showPaymentSending: vi.fn(),
  };
  const hook: { current: ReturnType<typeof useContactPayments> | null } = {
    current: null,
  };
  const Probe = () => {
    const payments = useContactPayments({
      ...ui,
      cashuBalance: 1_000,
      contactPayMethod: "cashu",
      contacts: [contact],
      formatDisplayedAmountParts: (amount) => ({
        approxPrefix: "",
        amountText: String(amount),
        unitLabel: "sat",
      }),
      getBankPaymentOfferForSettlement: () => null,
      isBankPaymentOfferCanceled: () => false,
      payAmount: "600",
      respondToBankPaymentOfferWithGroupState: async () => true,
      route: { kind: "wallet" },
      selectedContact: null,
      setLnAddressPay: () => {},
      t: (key) => key,
      walletOpRunning: false,
    });
    useEffect(() => {
      hook.current = payments;
    }, [payments]);
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  const pay = () =>
    act(() =>
      hook.current?.payContactWithCashuMessage({ amountSat: 600, contact }),
    );
  return { ...ui, pay, view };
};

afterEach(() => {
  commandsRef.current = null;
  vi.clearAllMocks();
});

describe("useContactPayments", () => {
  it("shows a sent payment and opens the chat", async () => {
    const payContact = commandsPaying({
      _tag: "Sent",
      receipt,
      contactId: CONTACT_ID,
      queued: false,
      publishErrors: [],
    });
    const ui = await render();

    expect(await ui.pay()).toBe(true);
    expect(payContact).toHaveBeenCalledOnce();
    expect(ui.showPaymentSending).toHaveBeenCalledWith(
      expect.objectContaining({ amountSat: 600, direction: "out" }),
    );
    expect(ui.showPaidOverlay).toHaveBeenCalledWith(
      "paidSentTo",
      expect.objectContaining({ amountSat: 600 }),
    );
    expect(ui.rememberFirstPayment).toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith({ id: CONTACT_ID, route: "chat" });
    await ui.view.unmount();
  });

  it("toasts publish errors of a queued payment and shows it queued", async () => {
    commandsPaying({
      _tag: "Sent",
      receipt,
      contactId: CONTACT_ID,
      queued: true,
      publishErrors: ["LinkstrNotConfigured"],
    });
    const ui = await render();

    expect(await ui.pay()).toBe(true);
    expect(ui.pushToast).toHaveBeenCalledWith(
      "payFailed: LinkstrNotConfigured",
    );
    expect(ui.showPaidOverlay).toHaveBeenCalledWith(
      "paidQueuedTo",
      expect.anything(),
    );
    await ui.view.unmount();
  });

  it.each<[PayContactOutcome, string]>([
    [{ _tag: "Insufficient" }, "payInsufficient"],
    [
      { _tag: "Failed", detail: "Insufficient funds", insufficient: true },
      "payInsufficient",
    ],
    [
      { _tag: "Failed", detail: "mint down", insufficient: false },
      "payFailed: mint down",
    ],
    [{ _tag: "NetworkError" }, "payNetworkError"],
    [{ _tag: "MissingIdentity" }, "profileMissingNpub"],
    [{ _tag: "MissingContactNpub" }, "chatMissingContactNpub"],
    [{ _tag: "AuthorizationChanged" }, "payApprovalChanged"],
  ])("reports %o as %s", async (outcome, status) => {
    commandsPaying(outcome);
    const ui = await render();

    expect(await ui.pay()).toBe(false);

    expect(ui.setStatus).toHaveBeenCalledWith(status);
    expect(ui.showPaidOverlay).not.toHaveBeenCalled();
    expect(ui.dismissPaymentSending).toHaveBeenCalled();
    await ui.view.unmount();
  });

  it("refuses a payment while the wallet is not ready", async () => {
    const ui = await render();

    expect(await ui.pay()).toBe(false);
    expect(ui.setStatus).toHaveBeenCalledWith(
      "errorPrefix: Cashu storage is not ready",
    );
    await ui.view.unmount();
  });
});
