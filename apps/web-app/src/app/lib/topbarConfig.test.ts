import * as Evolu from "@evolu/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Route } from "../../types/route";
import { setLinkyBankPaymentOfferMinimized } from "./bankPaymentOffer";
import {
  buildTopbarRight,
  resolveBackAction,
  type BackActionContext,
} from "./topbarConfig";

vi.mock("./bankPaymentOffer", () => ({
  setLinkyBankPaymentOfferMinimized: vi.fn(),
}));

const assignMock = vi.fn();

vi.stubGlobal("location", { assign: assignMock, hash: "" });

const contactId = Evolu.createIdFromString<"Contact">("contact-1");
const tokenId = Evolu.createIdFromString<"CashuToken">("token-1");

const closeContactDetail = vi.fn();
const navigateToMainReturn = vi.fn();

const baseContext: BackActionContext = {
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
  });

  it("walks settings sub-pages back up to settings", () => {
    expect(backHashFor({ kind: "settingsLanguage" })).toBe("#settings");
    expect(backHashFor({ kind: "settingsUnits" })).toBe("#settings");
    expect(backHashFor({ kind: "settingsMasterKeys" })).toBe("#settings");
    expect(backHashFor({ kind: "advancedAutoPayLimit" })).toBe("#settings");
    expect(backHashFor({ kind: "advancedInspector" })).toBe("#settings");
    expect(backHashFor({ kind: "advancedInspectorTimeline" })).toBe(
      "#advanced/inspector",
    );
    expect(backHashFor({ kind: "advancedPushDebug" })).toBe(
      "#advanced/inspector",
    );
    expect(backHashFor({ kind: "mints" })).toBe("#settings");
    expect(backHashFor({ kind: "nostrRelays" })).toBe("#settings");
    expect(backHashFor({ kind: "evoluServers" })).toBe("#settings");
  });

  it("walks wallet sub-pages back up one level at a time", () => {
    expect(backHashFor({ kind: "transactions" })).toBe("#wallet");
    expect(backHashFor({ kind: "topup" })).toBe("#wallet");
    expect(backHashFor({ kind: "topupNoAmount" })).toBe("#wallet/topup");
    expect(backHashFor({ kind: "topupInvoice" })).toBe("#wallet/topup");
    expect(backHashFor({ kind: "cashuTokens" })).toBe("#wallet");
    expect(backHashFor({ kind: "cashuTokenEmit" })).toBe("#wallet");
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

    expect(closeContactDetail).toHaveBeenCalledTimes(2);
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

    expect(setLinkyBankPaymentOfferMinimized).toHaveBeenCalledWith(
      "chat-1",
      "offer-1",
      true,
    );
  });
});

describe("buildTopbarRight", () => {
  it("offers the pencil on the bank payment page and hides it while editing", () => {
    const args = {
      chatEditContactId: null,
      isProfileEditing: false,
      openReceiveScan: vi.fn(),
      openScan: vi.fn(),
      t: (key: string) => key,
      toggleMenu: vi.fn(),
    };
    const button = buildTopbarRight({
      ...args,
      route: { kind: "bankPayment", spdPayload: "SPD*1.0" },
    });

    button?.onClick();

    expect(button?.icon).toBe("edit");
    expect(button?.label).toBe("spdPaymentEditFields");
    expect(assignMock).toHaveBeenLastCalledWith(
      "#wallet/bank-payment/SPD*1.0/edit",
    );
    expect(
      buildTopbarRight({
        ...args,
        route: { kind: "bankPayment", spdPayload: "SPD*1.0", editing: true },
      }),
    ).toBeNull();
  });

  it("opens the receive scanner from the top-up page", () => {
    const openReceiveScan = vi.fn();
    const button = buildTopbarRight({
      chatEditContactId: null,
      isProfileEditing: false,
      openReceiveScan,
      openScan: vi.fn(),
      route: { kind: "topup" },
      t: (key) => key,
      toggleMenu: vi.fn(),
    });

    button?.onClick();

    expect(button?.icon).toBe("scan");
    expect(openReceiveScan).toHaveBeenCalledOnce();
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
