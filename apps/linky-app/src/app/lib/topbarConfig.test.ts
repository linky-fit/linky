// @vitest-environment jsdom
import { createIdFromString } from "@linky-fit/linksync";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Route } from "../../types/route";
import { setBankPaymentOfferMinimized } from "./bankPaymentOfferStorage";
import {
  buildTopbar,
  buildTopbarLeading,
  buildTopbarRight,
  buildTopbarTitle,
  resolveBackAction,
  type BackActionContext,
} from "./topbarConfig";

vi.mock("./bankPaymentOfferStorage", () => ({
  setBankPaymentOfferMinimized: vi.fn(),
}));

const assignMock = vi.fn();

vi.stubGlobal("location", { assign: assignMock, hash: "" });

const contactId = createIdFromString<"Contact">("contact-1");
const tokenId = createIdFromString<"CashuOperation">("token-1");

const backFromContactNew = vi.fn();
const closeContactDetail = vi.fn();
const navigateToMainReturn = vi.fn();

const baseContext: BackActionContext = {
  backFromContactNew,
  closeContactDetail,
  contactPayBackToChatId: null,
  navigateToMainReturn,
};

const backHashFor = (
  route: Route,
  context: BackActionContext = baseContext,
): string | null => {
  const action = resolveBackAction(route, context);
  if (!action) return null;
  action();
  return assignMock.mock.calls.at(-1)?.[0] ?? null;
};

beforeEach(() => {
  assignMock.mockClear();
  closeContactDetail.mockClear();
  navigateToMainReturn.mockClear();
});

describe("resolveBackAction", () => {
  it("returns null on root screens so the app can exit", () => {
    expect(resolveBackAction({ kind: "contacts" }, baseContext)).toBeNull();
    expect(resolveBackAction({ kind: "wallet" }, baseContext)).toBeNull();
    expect(
      resolveBackAction({ kind: "collaboration" }, baseContext),
    ).toBeNull();
  });

  it("walks settings sub-pages back up to settings", () => {
    expect(backHashFor({ kind: "settingsLanguage" })).toBe("#settings");
    expect(backHashFor({ kind: "settingsUnits" })).toBe("#settings");
    expect(backHashFor({ kind: "settingsTutorial" })).toBe("#settings");
    expect(backHashFor({ kind: "settingsBlocked" })).toBe("#settings");
    expect(backHashFor({ kind: "settingsReceiveMethod" })).toBe("#settings");
    expect(backHashFor({ kind: "settingsMasterKeys" })).toBe("#settings");
    expect(backHashFor({ kind: "settingsNostrIdentity" })).toBe("#settings");
    expect(backHashFor({ kind: "bankPaymentNew" })).toBe("#proxy");
    expect(backHashFor({ kind: "proxyPayments" })).toBe("#collaboration");
    expect(backHashFor({ kind: "cash" })).toBe("#collaboration");
    expect(backHashFor({ kind: "listings" })).toBe("#collaboration");
    expect(backHashFor({ kind: "listingNew" })).toBe("#collaboration/listings");
    expect(backHashFor({ kind: "advancedAutoPayLimit" })).toBe("#settings");
    expect(backHashFor({ kind: "advancedInspector" })).toBe("#settings");
    expect(backHashFor({ kind: "advancedInspectorTimeline" })).toBe(
      "#advanced/inspector",
    );
    expect(backHashFor({ kind: "advancedPushDebug" })).toBe(
      "#advanced/inspector",
    );
    expect(backHashFor({ kind: "mints" })).toBe("#settings");
    expect(backHashFor({ kind: "mintNew" })).toBe("#advanced/mints");
    expect(backHashFor({ kind: "nostrRelays" })).toBe("#settings");
    expect(backHashFor({ kind: "evoluServers" })).toBe("#settings");
    expect(backHashFor({ kind: "chatStorage" })).toBe("#evolu-servers");
  });

  it("walks Keryx pages back through the company list to settings", () => {
    const id = createIdFromString<"KeryxSubscription">("company-1");
    expect(backHashFor({ kind: "keryxCompanies" })).toBe("#settings");
    expect(backHashFor({ kind: "keryxCompanyNew" })).toBe("#settings/keryx");
    expect(backHashFor({ kind: "keryxCompany", id })).toBe("#settings/keryx");
    expect(backHashFor({ kind: "keryxAnnouncement", id, key: "news/a" })).toBe(
      `#settings/keryx/${id}`,
    );
  });

  it("walks on-chain transfer pages back to where they open from", () => {
    const id = createIdFromString<"OnchainTransfer">("transfer-1");
    expect(
      backHashFor({ kind: "onchainSend", payoutAddress: "", amount: null }),
    ).toBe("#wallet");
    expect(backHashFor({ kind: "onchainReceive" })).toBe("#wallet/topup");
    expect(backHashFor({ kind: "onchainTransfer", id })).toBe(
      "#wallet/transactions",
    );
  });

  it("walks wallet sub-pages back up one level at a time", () => {
    expect(backHashFor({ kind: "transactions" })).toBe("#wallet");
    expect(backHashFor({ kind: "topup" })).toBe("#wallet");
    expect(backHashFor({ kind: "topupNoAmount" })).toBe("#wallet/topup");
    expect(backHashFor({ kind: "topupInvoice" })).toBe("#wallet/topup");
    expect(backHashFor({ kind: "cashuTokens" })).toBe("#wallet");
    expect(backHashFor({ kind: "cashuTokenEmit" })).toBe("#wallet");
    expect(backHashFor({ kind: "cashuProofs" })).toBe("#wallet/tokens");
    expect(backHashFor({ kind: "cashuTokenNew" })).toBe("#wallet/tokens");
    expect(backHashFor({ kind: "cashuToken", id: tokenId })).toBe(
      "#wallet/tokens",
    );
  });

  it("returns to the main screen the user came from", () => {
    resolveBackAction({ kind: "settings" }, baseContext)?.();
    resolveBackAction({ kind: "advanced" }, baseContext)?.();
    resolveBackAction({ kind: "profile" }, baseContext)?.();

    expect(navigateToMainReturn).toHaveBeenCalledTimes(3);
  });

  it("closes the contact detail rather than navigating by hash", () => {
    resolveBackAction({ kind: "contact", id: contactId }, baseContext)?.();
    resolveBackAction({ kind: "contactNew" }, baseContext)?.();

    expect(closeContactDetail).toHaveBeenCalledOnce();
    expect(backFromContactNew).toHaveBeenCalledOnce();
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("sends contact pay back to the chat it was opened from", () => {
    expect(
      backHashFor(
        { kind: "contactPay", id: contactId },
        { ...baseContext, contactPayBackToChatId: contactId },
      ),
    ).toBe(`#chat/${contactId}`);
  });

  it("sends contact pay back to the contact when not opened from a chat", () => {
    expect(backHashFor({ kind: "contactPay", id: contactId })).toBe(
      `#contact/${contactId}`,
    );
  });

  it("sends a bank payment offer back to its chat", () => {
    expect(
      backHashFor({
        kind: "bankPaymentOffer",
        chatId: "chat-1",
        offerId: "offer-1",
      }),
    ).toBe("#chat/chat-1");
  });

  it("marks a bank payment offer minimized on the way back", () => {
    resolveBackAction(
      { kind: "bankPaymentOffer", chatId: "chat-1", offerId: "offer-1" },
      baseContext,
    )?.();

    expect(setBankPaymentOfferMinimized).toHaveBeenCalledWith(
      "chat-1",
      "offer-1",
      true,
    );
  });
});

describe("buildTopbar", () => {
  it("hides the back button on the bottom-nav roots", () => {
    const args = {
      backFromContactNew: vi.fn(),
      closeContactDetail: vi.fn(),
      contactPayBackToChatId: null,
      navigateToMainReturn: vi.fn(),
      t: (key: string) => key,
    };

    expect(buildTopbar({ ...args, route: { kind: "profile" } })).toBeNull();
    expect(buildTopbar({ ...args, route: { kind: "settings" } })).toBeNull();
    expect(buildTopbar({ ...args, route: { kind: "advanced" } })?.icon).toBe(
      "ChevronLeft",
    );
  });
});

describe("buildTopbarLeading", () => {
  const t = (key: string) => key;
  const leadingArgs = {
    contactsFilterIsActive: false,
    isProfileEditing: false,
    pendingOnchainTransfers: null,
    t,
    toggleContactsFilter: vi.fn(),
  };

  it("toggles the contact filter from the contacts page", () => {
    const toggleContactsFilter = vi.fn();
    const button = buildTopbarLeading({
      ...leadingArgs,
      contactsFilterIsActive: true,
      route: { kind: "contacts" },
      toggleContactsFilter,
    });

    button?.onClick();

    expect(button?.icon).toBe("Search");
    expect(button?.isActive).toBe(true);
    expect(toggleContactsFilter).toHaveBeenCalledOnce();
  });

  it("offers the pencil on the profile until editing starts", () => {
    const button = buildTopbarLeading({
      ...leadingArgs,
      route: { kind: "profile" },
    });

    button?.onClick();

    expect(button).toMatchObject({
      guide: "profile-edit",
      icon: "Pencil",
      label: "edit",
    });
    expect(assignMock).toHaveBeenLastCalledWith("#profile/edit");
    expect(
      buildTopbarLeading({
        ...leadingArgs,
        isProfileEditing: true,
        route: { kind: "profile" },
      }),
    ).toBeNull();
  });

  it("marks unfinished on-chain transfers on the wallet with a dot that opens them", () => {
    const open = vi.fn();
    const button = buildTopbarLeading({
      ...leadingArgs,
      pendingOnchainTransfers: { label: "Pending", open },
      route: { kind: "wallet" },
    });
    button?.onClick();

    expect(button).toMatchObject({ indicator: "warning", label: "Pending" });
    expect(open).toHaveBeenCalledOnce();
    expect(
      buildTopbarLeading({ ...leadingArgs, route: { kind: "wallet" } }),
    ).toBeNull();
  });

  it("leaves the other root screens without a leading button", () => {
    expect(
      buildTopbarLeading({ ...leadingArgs, route: { kind: "proxyPayments" } }),
    ).toBeNull();
    expect(
      buildTopbarLeading({ ...leadingArgs, route: { kind: "settings" } }),
    ).toBeNull();
  });
});

describe("buildTopbarRight", () => {
  const t = (key: string) => key;
  const rightArgs = {
    chatEditContactId: null,
    deleteEditedContact: vi.fn(),
    hiddenTransactionsShown: false,
    isProfileEditing: false,
    openContactScan: vi.fn(),
    openReceiveScan: vi.fn(),
    openWalletScan: vi.fn(),
    t,
    toggleHiddenTransactions: vi.fn(),
    openMenu: vi.fn(),
  };

  it("opens the contact scanner from the profile and the contacts", () => {
    const openContactScan = vi.fn();
    const openWalletScan = vi.fn();
    for (const kind of ["profile", "contacts"] as const) {
      const button = buildTopbarRight({
        ...rightArgs,
        openContactScan,
        openWalletScan,
        route: { kind },
      });
      button?.onClick();
      expect(button).toMatchObject({ icon: "ScanLine", label: "scan" });
    }

    expect(openContactScan).toHaveBeenCalledTimes(2);
    expect(openWalletScan).not.toHaveBeenCalled();
    expect(
      buildTopbarRight({
        ...rightArgs,
        isProfileEditing: true,
        route: { kind: "profile" },
      }),
    ).toBeNull();
  });

  it("opens the payment scanner from the wallet, proxy and settings", () => {
    const openContactScan = vi.fn();
    const openWalletScan = vi.fn();
    for (const kind of [
      "wallet",
      "collaboration",
      "proxyPayments",
      "settings",
    ] as const) {
      const button = buildTopbarRight({
        ...rightArgs,
        openContactScan,
        openWalletScan,
        route: { kind },
      });
      button?.onClick();
      expect(button).toMatchObject({ icon: "ScanLine", label: "scan" });
    }

    expect(openWalletScan).toHaveBeenCalledTimes(4);
    expect(openContactScan).not.toHaveBeenCalled();
  });

  it("offers the pencil on the bank payment page and hides it while editing", () => {
    const button = buildTopbarRight({
      ...rightArgs,
      route: { kind: "bankPayment", spdPayload: "SPD*1.0" },
    });

    button?.onClick();

    expect(button?.icon).toBe("Pencil");
    expect(button?.label).toBe("spdPaymentEditFields");
    expect(assignMock).toHaveBeenLastCalledWith(
      "#wallet/bank-payment/SPD*1.0/edit",
    );
    expect(
      buildTopbarRight({
        ...rightArgs,
        route: { kind: "bankPayment", spdPayload: "SPD*1.0", editing: true },
      }),
    ).toBeNull();
  });

  it("anchors the contact tutorial to the edit pencil", () => {
    expect(
      buildTopbarRight({
        ...rightArgs,
        route: { kind: "contact", id: contactId },
      }),
    ).toMatchObject({ guide: "contact-edit", icon: "Pencil" });
    expect(
      buildTopbarRight({
        ...rightArgs,
        chatEditContactId: contactId,
        route: { kind: "chat", id: contactId },
      }),
    ).toMatchObject({ guide: "contact-edit", icon: "Pencil" });
  });

  it("deletes the edited contact from the contact edit page", () => {
    const deleteEditedContact = vi.fn();
    const button = buildTopbarRight({
      ...rightArgs,
      deleteEditedContact,
      route: { kind: "contactEdit", id: contactId },
    });

    button?.onClick();

    expect(button?.icon).toBe("Trash2");
    expect(button?.label).toBe("deleteContact");
    expect(deleteEditedContact).toHaveBeenCalledTimes(1);
  });

  it("opens the receive scanner from the top-up page", () => {
    const openReceiveScan = vi.fn();
    const button = buildTopbarRight({
      ...rightArgs,
      openReceiveScan,
      route: { kind: "topup" },
    });

    button?.onClick();

    expect(button?.icon).toBe("ScanLine");
    expect(openReceiveScan).toHaveBeenCalledOnce();
  });

  it("toggles hidden rows from the transactions page", () => {
    const toggleHiddenTransactions = vi.fn();
    const button = buildTopbarRight({
      ...rightArgs,
      hiddenTransactionsShown: true,
      route: { kind: "transactions" },
      toggleHiddenTransactions,
    });

    button?.onClick();

    expect(button).toMatchObject({
      icon: "Eye",
      isActive: true,
      label: "transactionsHideHidden",
    });
    expect(toggleHiddenTransactions).toHaveBeenCalledOnce();
  });
});

describe("resolveBackAction for bank payment editing", () => {
  it("leaves the edit form back to the same payment", () => {
    expect(
      backHashFor({
        kind: "bankPayment",
        spdPayload: "SPD*1.0",
        editing: true,
      }),
    ).toBe("#wallet/bank-payment/SPD*1.0");
    expect(backHashFor({ kind: "bankPayment", spdPayload: "SPD*1.0" })).toBe(
      "#wallet",
    );
  });
});

describe("buildTopbarTitle", () => {
  const t = (key: string) => key;

  it("titles an on-chain transfer by its direction once known, and a transaction as a payment", () => {
    const id = createIdFromString<"OnchainTransfer">("transfer-1");
    expect(buildTopbarTitle({ kind: "onchainTransfer", id }, t)).toBe(
      "onchainTransferTitle",
    );
    expect(buildTopbarTitle({ kind: "onchainTransfer", id }, t, "send")).toBe(
      "onchainSendTitle",
    );
    expect(
      buildTopbarTitle({ kind: "onchainTransfer", id }, t, "receive"),
    ).toBe("onchainReceiveTitle");
    expect(buildTopbarTitle({ kind: "transaction", id: "tx-1" }, t)).toBe(
      "transactionTitle",
    );
    expect(backHashFor({ kind: "transaction", id: "tx-1" })).toBe(
      "#wallet/transactions",
    );
  });
});
