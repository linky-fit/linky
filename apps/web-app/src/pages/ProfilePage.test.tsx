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
  shuffleProfileAvatar: () => {},
  derivedProfile: null,
  effectiveMyLightningAddress: null,
  effectiveProfileName: null,
  effectiveProfilePicture: null,
  isProfileEditing: true,
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
  profileIsSaving: false,
  unregisteredOwnLightningAddress: {
    issue: null,
    lightningAddress: "alice@linky.fit",
    username: "alice",
  },
  profileStatus: null,
  profilePhotoInputRef: React.createRef(),
  profileSelectedPictureKind: "generated",
  makeNip98AuthHeader: async () => "auth",
  payLightningInvoiceWithCashu: pay,
  saveClaimedLightningAddress: save,
  saveProfileEdits: async () => {},
  serverBaseUrl: "https://npub.linky.fit",
  setProfileEditLnAddress: () => {},
  setProfileEditName: () => {},
  setProfileEditStatus: () => {},
  shareText: async () => {},
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
  Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Purchase for"),
  ) ?? null;

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
    expect(button?.getAttribute("aria-disabled")).toBe("true");
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

describe("sharing the profile", () => {
  const openShareSheet = async (shareText = vi.fn(async () => {})) => {
    const copyText = vi.fn(async () => {});
    rendered = await renderIntoDocument(
      <ProfilePage
        {...props}
        isProfileEditing={false}
        copyText={copyText}
        shareText={shareText}
      />,
    );
    const share = Array.from(
      rendered.container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("shareProfile"));
    await act(async () => {
      share?.click();
    });
    const action = (label: string) =>
      Array.from(
        document.body.querySelectorAll<HTMLElement>(
          '[data-testid="profile-share-action"]',
        ),
      ).find((row) => row.textContent === label);
    return { action, copyText };
  };

  it("copies the npub from the in-app share sheet", async () => {
    const { action, copyText } = await openShareSheet();
    await act(async () => {
      action("copyNpub")?.click();
    });
    expect(copyText).toHaveBeenCalledExactlyOnceWith("npub1test");
  });
  it("offers the system share only where the device has one", async () => {
    vi.stubGlobal("navigator", { ...navigator, share: undefined });
    const { action } = await openShareSheet();
    expect(action("copyProfileLink")).toBeDefined();
    expect(action("share")).toBeUndefined();
  });
});
