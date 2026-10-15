import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { TopupInvoicePage } from "./TopupInvoicePage";

vi.mock("../components/DisplayAmount", () => ({
  DisplayAmount: ({ amount }: { amount: number }) => (
    <div data-testid="wallet-balance">{amount}</div>
  ),
}));

vi.mock("@linky-fit/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/ui")>()),
  QRCode: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));

const translate = (key: string): string => {
  switch (key) {
    case "copy":
      return "Copy";
    case "topupFetchingInvoice":
      return "Loading invoice...";
    case "topupInvoiceTitle":
      return "Top-up invoice";
    default:
      return key;
  }
};

const qrValue = (container: HTMLElement) =>
  container.querySelector('[data-testid="qr"]')?.textContent ?? null;

const pressCopy = async (container: HTMLElement) => {
  await act(async () => {
    container
      .querySelector('[data-testid="topup-invoice-copy"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
};

describe("TopupInvoicePage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows loading instead of a stale QR while a fresh invoice is loading", async () => {
    const { container } = await renderIntoDocument(
      <TopupInvoicePage
        copyText={async () => {}}
        receiveMethod="universal"
        t={translate}
        topupAmount="21"
        topupInvoice="lnbc-old"
        topupInvoiceCashuRequest="creqAold"
        topupInvoiceError={null}
        topupInvoiceIsBusy={true}
        topupInvoiceQrPayload="bitcoin:?lightning=lnbc-old"
        topupMintUrl="https://mint.example"
      />,
    );

    expect(container.textContent).toContain("Loading invoice...");
    expect(qrValue(container)).toBeNull();
  });

  it("shows the universal QR and copies its payload by default", async () => {
    const copied: string[] = [];

    const { container } = await renderIntoDocument(
      <TopupInvoicePage
        copyText={async (text) => {
          copied.push(text);
        }}
        receiveMethod="universal"
        t={translate}
        topupAmount="21"
        topupInvoice="lnbc-invoice"
        topupInvoiceCashuRequest="creqArequest"
        topupInvoiceError={null}
        topupInvoiceIsBusy={false}
        topupInvoiceQrPayload="bitcoin:?lightning=lnbc-invoice&creq=creqArequest"
        topupMintUrl="https://mint.example"
      />,
    );

    expect(qrValue(container)).toBe(
      "bitcoin:?lightning=lnbc-invoice&creq=creqArequest",
    );
    expect(container.querySelector('[role="tab"]')).toBeNull();

    await pressCopy(container);
    expect(copied).toEqual([
      "bitcoin:?lightning=lnbc-invoice&creq=creqArequest",
    ]);
  });

  it("renders the cashu request when cashu is the receive method", async () => {
    const copied: string[] = [];

    const { container } = await renderIntoDocument(
      <TopupInvoicePage
        copyText={async (text) => {
          copied.push(text);
        }}
        receiveMethod="cashu"
        t={translate}
        topupAmount="21"
        topupInvoice="lnbc-invoice"
        topupInvoiceCashuRequest="creqArequest"
        topupInvoiceError={null}
        topupInvoiceIsBusy={false}
        topupInvoiceQrPayload="bitcoin:?lightning=lnbc-invoice&creq=creqArequest"
        topupMintUrl="https://mint.example"
      />,
    );

    expect(qrValue(container)).toBe("creqArequest");
    await pressCopy(container);
    expect(copied).toEqual(["creqArequest"]);
  });

  it("falls back to the universal QR when the cashu request is missing", async () => {
    const { container } = await renderIntoDocument(
      <TopupInvoicePage
        copyText={async () => {}}
        receiveMethod="cashu"
        t={translate}
        topupAmount="21"
        topupInvoice="lnbc-invoice"
        topupInvoiceCashuRequest={null}
        topupInvoiceError={null}
        topupInvoiceIsBusy={false}
        topupInvoiceQrPayload="bitcoin:?lightning=lnbc-invoice"
        topupMintUrl="https://mint.example"
      />,
    );

    expect(qrValue(container)).toBe("bitcoin:?lightning=lnbc-invoice");
  });

  it("renders the lightning invoice when lightning is the receive method", async () => {
    const { container } = await renderIntoDocument(
      <TopupInvoicePage
        copyText={async () => {}}
        receiveMethod="lightning"
        t={translate}
        topupAmount="21"
        topupInvoice="lnbc-invoice"
        topupInvoiceCashuRequest="creqArequest"
        topupInvoiceError={null}
        topupInvoiceIsBusy={false}
        topupInvoiceQrPayload="bitcoin:?lightning=lnbc-invoice&creq=creqArequest"
        topupMintUrl="https://mint.example"
      />,
    );

    expect(qrValue(container)).toBe("LNBC-INVOICE");
  });
});
