import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderIntoDocument,
  type RenderedElement,
} from "../testUtils/renderIntoDocument";
import {
  makeLightningInvoice,
  invoiceTimestamp,
} from "../testUtils/lightningInvoice";
import { ProfilePage } from "./ProfilePage";

const core = vi.hoisted(() => ({
  t: (key: string) =>
    key === "claimOwnLightningAddressPurchaseFor"
      ? "Purchase for {amount}"
      : key,
  formatDisplayedAmountParts: (amount: number) => ({
    approxPrefix: "",
    amountText: String(amount),
    unitLabel: "sat",
  }),
}));
vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => core,
}));
vi.mock("../components/ProfileAvatarEditor", () => ({
  ProfileAvatarEditor: () => null,
}));

const pay = vi
  .fn<(invoice: string) => Promise<boolean>>()
  .mockResolvedValue(true);
const save = vi
  .fn<(address: string) => Promise<boolean>>()
  .mockResolvedValue(true);
const props: React.ComponentProps<typeof ProfilePage> = {
  cashuBalance: 5000,
  cashuBalanceAfterMelt: 5000,
  cashuIsBusy: false,
  canWriteToNfc: false,
  copyText: async () => {},
  currentNpub: "npub1test",
  cycleProfileAvatarControl: () => {},
  derivedProfile: null,
  effectiveMyLightningAddress: null,
  effectiveProfileName: null,
  effectiveProfilePicture: null,
  isProfileEditing: true,
  myProfileQr: null,
  onPickProfilePhoto: async () => {},
  onProfilePhotoError: () => {},
  onProfilePhotoSelected: () => {},
  ownedLightningAddresses: [],
  profileCustomPictureUrl: "",
  profileEditLnAddress: "alice",
  profileEditName: "Alice",
  profileEditPicture: "",
  profileEditStatus: "",
  profileEditsSavable: true,
  unregisteredOwnLightningAddress: {
    issue: null,
    lightningAddress: "alice@linky.fit",
    username: "alice",
  },
  profileStatus: null,
  profileStatusCurrencies: [],
  profileStatusIsSaving: false,
  profilePhotoInputRef: React.createRef(),
  profileSelectedPictureKind: "generated",
  makeNip98AuthHeader: async () => "auth",
  payLightningInvoiceWithCashu: pay,
  saveClaimedLightningAddress: save,
  saveProfileEdits: async () => {},
  selectedProfileStatusCurrencies: [],
  serverBaseUrl: "https://npub.linky.fit",
  setProfileEditLnAddress: () => {},
  setProfileEditName: () => {},
  setProfileEditStatus: () => {},
  toggleProfileStatusCurrency: async () => {},
  writeCurrentNpubToNfc: async () => {},
};
let rendered: RenderedElement | undefined;
const setup = async (invoice: string, balance = 5000) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("https://npub.linky.fit/api/v1/info/username");
    const finalized = String(init?.body).includes("paymentToken");
    return new Response(
      JSON.stringify(
        finalized
          ? { error: false }
          : {
              message: "Payment required",
              data: { paymentRequest: invoice, paymentToken: "original-token" },
            },
      ),
      { status: finalized ? 200 : 402 },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  rendered = await renderIntoDocument(
    <ProfilePage
      {...props}
      cashuBalance={balance}
      cashuBalanceAfterMelt={balance}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  return { ...rendered, fetcher };
};
const purchaseButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>(
    ".profile-lightning-purchase-button",
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(invoiceTimestamp * 1000);
  vi.clearAllMocks();
});
afterEach(async () => {
  await rendered?.unmount();
  rendered = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("username purchase approval", () => {
  it.each([
    "lnbc1testinvoice",
    "https://attacker.example",
    makeLightningInvoice(""),
    makeLightningInvoice("20u", 0),
  ])(
    "does not offer payment for invalid/amountless/expired invoice %s",
    async (invoice) => {
      const { container } = await setup(invoice);
      expect(purchaseButton(container)).toBeNull();
      expect(pay).not.toHaveBeenCalled();
    },
  );
  it("disables purchase when the displayed price exceeds the balance", async () => {
    const { container } = await setup(makeLightningInvoice(), 1999);
    const button = purchaseButton(container);
    expect(button?.textContent).toContain("2000 sat");
    expect(button?.disabled).toBe(true);
    await act(async () => {
      button?.click();
    });
    expect(pay).not.toHaveBeenCalled();
  });
  it("pays the displayed invoice then finalizes the same claim", async () => {
    const invoice = makeLightningInvoice();
    const { container, fetcher } = await setup(invoice);
    expect(purchaseButton(container)?.textContent).toContain("2000 sat");
    await act(async () => {
      purchaseButton(container)?.click();
    });
    expect(pay).toHaveBeenCalledExactlyOnceWith(invoice);
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ paymentToken: "original-token", username: "alice" }),
    );
    expect(save).toHaveBeenCalledWith("alice@linky.fit");
  });
  it("rechecks expiry at the click before paying", async () => {
    const { container } = await setup(makeLightningInvoice("20u", 2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      purchaseButton(container)?.click();
    });
    expect(pay).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "claimOwnLightningAddressInvoiceInvalid",
    );
  });
});
