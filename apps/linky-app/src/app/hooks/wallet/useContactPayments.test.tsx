import * as Evolu from "@evolu/common";
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
import type { ContactWithChatState } from "../../lib/contactChatState";
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
const shownContact: ContactWithChatState = {
  id: CONTACT_ID,
  name: Evolu.NonEmptyString1000.orThrow("Alice"),
  npub: Evolu.NonEmptyString1000.orThrow("npub1alice"),
  nameSetByUser: null,
  lnAddress: null,
  lnAddressSetByUser: null,
  groupName: null,
  groupNamesJson: null,
  archivedAtSec: null,
  chatLastSeenAtSec: null,
  chatPeerSeenSinceSec: null,
  chatPeerSeenAtSec: null,
  ownerId: Evolu.createAppOwner(
    Evolu.OwnerSecret.orThrow(new Uint8Array(32).fill(1)),
  ).id,
  createdAt: Evolu.DateIso.orThrow(new Date(0).toISOString()),
  updatedAt: Evolu.DateIso.orThrow(new Date(0).toISOString()),
  isDeleted: null,
};

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
    quotePaymentRequest: vi.fn(),
  };
  return payContact;
};

type Overrides = Partial<
  Pick<
    Parameters<typeof useContactPayments>[0],
    "route" | "selectedContact" | "walletOpRunning"
  >
>;

const render = async (overrides: Overrides = {}) => {
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
      ...overrides,
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
  const paySelected = () =>
    act(() => hook.current?.paySelectedContact({ note: null }));
  return { ...ui, pay, paySelected, view };
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
    [{ _tag: "Busy" }, "payWalletBusy"],
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

  it.each<[string, Overrides, string]>([
    [
      "the wallet is busy",
      {
        route: { kind: "contactPay", id: CONTACT_ID },
        selectedContact: shownContact,
        walletOpRunning: true,
      },
      "payWalletBusy",
    ],
    [
      "the pay screen shows no contact",
      { route: { kind: "contactPay", id: CONTACT_ID }, selectedContact: null },
      "contactNotFound",
    ],
    [
      "the pay screen is not open",
      { route: { kind: "wallet" }, selectedContact: shownContact },
      "contactNotFound",
    ],
  ])(
    "tells why a pay-screen payment stops when %s",
    async (_, overrides, status) => {
      const payContact = commandsPaying({ _tag: "Insufficient" });
      const ui = await render(overrides);

      await ui.paySelected();

      expect(ui.setStatus).toHaveBeenCalledWith(status);
      expect(payContact).not.toHaveBeenCalled();
      await ui.view.unmount();
    },
  );

  it("pays the contact the pay screen shows", async () => {
    const payContact = commandsPaying({ _tag: "Insufficient" });
    const ui = await render({
      route: { kind: "contactPay", id: CONTACT_ID },
      selectedContact: shownContact,
    });

    await ui.paySelected();

    expect(payContact).toHaveBeenCalledWith(
      expect.objectContaining({ amountSat: 600, contact: shownContact }),
      expect.anything(),
    );
    await ui.view.unmount();
  });
});
