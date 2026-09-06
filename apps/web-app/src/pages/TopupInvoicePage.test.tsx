import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { TopupInvoicePage } from "./TopupInvoicePage";

vi.mock("../components/WalletBalance", () => ({
  WalletBalance: ({ balance }: { balance: number }) => (
    <div data-testid="wallet-balance">{balance}</div>
  ),
}));

vi.mock("qrcode", () => ({
  toDataURL: vi.fn(async (payload: string) => `qr:${payload}`),
}));

const translate = (key: string): string => {
  switch (key) {
    case "copy":
      return "Copy";
    case "topupFetchingInvoice":
      return "Loading invoice...";
    case "topupInvoiceTitle":
      return "Top-up invoice";
    case "topupQrModeLabel":
      return "Receive QR type";
    case "topupQrModeCashu":
      return "Cashu";
    case "topupQrModeUniversal":
      return "Universal";
    case "topupQrModeLightning":
      return "Lightning";
    default:
      return key;
  }
};

// The QR src updates asynchronously (qrcode.toDataURL + setState), so poll
// until the assertion holds instead of racing it with a fixed delay.
const waitFor = async (assertion: () => void): Promise<void> => {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await act(async () => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 10);
        });
      });
    }
  }
};

describe("TopupInvoicePage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows loading instead of a stale QR while a fresh invoice is loading", async () => {
    const { container } = await renderIntoDocument(
      <TopupInvoicePage
        copyText={async () => {}}
        t={translate}
        topupAmount="21"
        topupInvoice="lnbc-old"
        topupInvoiceCashuRequest="creqAold"
        topupInvoiceError={null}
        topupInvoiceIsBusy={true}
        topupInvoiceQr="data:image/png;base64,old"
        topupInvoiceQrPayload="bitcoin:?lightning=lnbc-old"
        topupMintUrl="https://mint.example"
      />,
    );

    expect(container.textContent).toContain("Loading invoice...");
    expect(container.querySelector(".topup-invoice-qr")).toBeNull();
  });

  it("defaults to the universal QR and switches to Cashu or Lightning only", async () => {
    const copied: string[] = [];

    const { container, root } = await renderIntoDocument(
      <TopupInvoicePage
        copyText={async (text) => {
          copied.push(text);
        }}
        t={translate}
        topupAmount="21"
        topupInvoice="lnbc-invoice"
        topupInvoiceCashuRequest="creqArequest"
        topupInvoiceError={null}
        topupInvoiceIsBusy={false}
        topupInvoiceQr="data:image/png;base64,universal"
        topupInvoiceQrPayload="bitcoin:?lightning=lnbc-invoice&creq=creqArequest"
        topupMintUrl="https://mint.example"
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector(".topup-invoice-qr")?.getAttribute("src"),
    ).toBe("data:image/png;base64,universal");

    await act(async () => {
      container
        .querySelector(".topup-invoice-copy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(copied).toEqual([
      "bitcoin:?lightning=lnbc-invoice&creq=creqArequest",
    ]);

    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    const cashuTab = tabs.find((tab) => tab.textContent === "Cashu") ?? null;

    await act(async () => {
      cashuTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => {
      expect(
        container.querySelector(".topup-invoice-qr")?.getAttribute("src"),
      ).toBe("qr:creqArequest");
    });

    await act(async () => {
      container
        .querySelector(".topup-invoice-copy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(copied.at(-1)).toBe("creqArequest");

    const lightningTab =
      tabs.find((tab) => tab.textContent === "Lightning") ?? null;

    await act(async () => {
      lightningTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitFor(() => {
      expect(
        container.querySelector(".topup-invoice-qr")?.getAttribute("src"),
      ).toBe("qr:LNBC-INVOICE");
    });

    await act(async () => {
      container
        .querySelector(".topup-invoice-copy")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(copied.at(-1)).toBe("lnbc-invoice");

    await act(async () => {
      root.unmount();
    });
  });
});
