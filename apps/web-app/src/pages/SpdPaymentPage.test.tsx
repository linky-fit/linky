import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { SpdPaymentPage } from "./SpdPaymentPage";

const { navigateTo } = vi.hoisted(() => ({ navigateTo: vi.fn() }));

vi.mock("../hooks/useRouting", () => ({ navigateTo }));

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellActions: () => ({
    cycleDisplayCurrency: () => undefined,
  }),
  useAppShellCore: () => ({
    allowedDisplayCurrencies: ["sat"],
    displayCurrency: "sat",
    displayUnit: "sat",
    formatDisplayedAmountText: (amountSat: number) => `${amountSat} sat`,
    lang: "en",
    t: (key: string) => translate(key),
  }),
}));

vi.mock("../app/hooks/useFiatRates", () => ({
  useFiatRates: () => ({
    chfPerBtc: 1_000_000,
    czkPerBtc: 1_000_000,
    eurPerBtc: 1_000_000,
    usdPerBtc: 1_000_000,
  }),
}));

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setter) {
    throw new Error("HTML input value setter missing");
  }
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const translate = (key: string): string => {
  if (key === "spdPaymentRequestReimbursementCountOther") {
    return "Ask {count} contacts to pay";
  }
  if (key === "spdPaymentLastResponseTime") {
    return "Last time {time}";
  }
  return key;
};

describe("SpdPaymentPage offer recipients", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("selects the first configured contacts and sends manual changes", async () => {
    const onRequestReimbursement = vi.fn(async () => null);

    const { container } = await renderIntoDocument(
      <SpdPaymentPage
        cashuBalanceAfterMelt={100_000}
        initialOfferContactCount={2}
        initialOfferDelaySec={0}
        isEditing={false}
        offerContacts={[
          { id: "a", name: "Alice", npub: "npub1alice" },
          { id: "b", name: "Bob", npub: "npub1bob" },
          { id: "c", name: "Carol", npub: "npub1carol" },
        ]}
        onRequestReimbursement={onRequestReimbursement}
        spdPayload="SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK"
      />,
    );

    const contactButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".bank-payment-offer-contact",
      ),
    );
    expect(
      contactButtons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["true", "true", "false"]);
    const requestButton = container.querySelector<HTMLButtonElement>(
      ".bank-payment-request",
    );
    const contactList = container.querySelector(
      ".bank-payment-offer-contact-list",
    );
    expect(
      requestButton &&
        contactList &&
        Boolean(requestButton.compareDocumentPosition(contactList) & 4),
    ).toBe(true);

    await act(async () => {
      contactButtons[1]?.click();
      contactButtons[2]?.click();
    });

    // The delay stepper moves in 5 s increments and travels with the offer.
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '.bank-payment-offer-delay [aria-label="bankPaymentOfferStaggerDelayIncrease"]',
        )
        ?.click();
    });

    await act(async () => {
      requestButton?.click();
    });

    expect(onRequestReimbursement).toHaveBeenCalledOnce();
    expect(onRequestReimbursement).toHaveBeenCalledWith(
      expect.objectContaining({
        contacts: [
          expect.objectContaining({ id: "a" }),
          expect.objectContaining({ id: "c" }),
        ],
        staggerDelaySec: 5,
      }),
    );
  });

  it("numbers selected recipients and re-adds a removed contact at the end", async () => {
    const { container } = await renderIntoDocument(
      <SpdPaymentPage
        cashuBalanceAfterMelt={100_000}
        initialOfferContactCount={3}
        initialOfferDelaySec={5}
        isEditing={false}
        offerContacts={[
          { id: "a", name: "Alice", npub: "npub1alice" },
          { id: "b", name: "Bob", npub: "npub1bob" },
          { id: "c", name: "Carol", npub: "npub1carol" },
        ]}
        onRequestReimbursement={async () => null}
        spdPayload="SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK"
      />,
    );

    const readOrders = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          ".bank-payment-offer-contact",
        ),
      ).map(
        (button) =>
          button.querySelector(".bank-payment-offer-contact-order")
            ?.textContent ?? null,
      );

    expect(readOrders()).toEqual(["1", "2", "3"]);

    const contactButtons = container.querySelectorAll<HTMLButtonElement>(
      ".bank-payment-offer-contact",
    );

    // Removing the second contact moves the third one up…
    await act(async () => {
      contactButtons[1]?.click();
    });
    expect(readOrders()).toEqual(["1", null, "2"]);

    // …and re-adding it puts it at the end of the queue.
    await act(async () => {
      contactButtons[1]?.click();
    });
    expect(readOrders()).toEqual(["1", "3", "2"]);

    const delayValue = container.querySelector(
      ".bank-payment-offer-delay .settings-stepper-value",
    );
    expect(delayValue?.textContent).toBe("5 s");
  });

  it("opens the newly created proxy payment", async () => {
    const onRequestReimbursement = vi.fn(async () => ({
      chatId: "contact-a",
      offerId: "offer-1",
    }));

    const { container } = await renderIntoDocument(
      <SpdPaymentPage
        cashuBalanceAfterMelt={100_000}
        initialOfferContactCount={1}
        initialOfferDelaySec={0}
        isEditing={false}
        offerContacts={[{ id: "contact-a", name: "Alice", npub: "npub1alice" }]}
        onRequestReimbursement={onRequestReimbursement}
        spdPayload="SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK"
      />,
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".bank-payment-request")
        ?.click();
    });

    expect(navigateTo).toHaveBeenCalledWith({
      route: "bankPaymentOffer",
      chatId: "contact-a",
      offerId: "offer-1",
    });
  });

  it("shows each candidate's last payment response in minutes and seconds", async () => {
    const { container } = await renderIntoDocument(
      <SpdPaymentPage
        cashuBalanceAfterMelt={100_000}
        initialOfferContactCount={1}
        initialOfferDelaySec={0}
        isEditing={false}
        offerContacts={[
          {
            id: "contact-a",
            lastBankPaymentResponseSec: 125,
            name: "Alice",
            npub: "npub1alice",
          },
          { id: "contact-b", name: "Bob", npub: "npub1bob" },
        ]}
        onRequestReimbursement={async () => null}
        spdPayload="SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK"
      />,
    );

    const candidates = container.querySelectorAll(
      ".bank-payment-offer-contact",
    );
    expect(candidates[0]?.textContent).toContain("Last time 02:05");
    expect(candidates[1]?.textContent).not.toContain("Last time");
  });

  const renderEditable = async (
    spdPayload: string,
    onRequestReimbursement: () => Promise<{
      chatId: string;
      offerId: string;
    } | null>,
  ) => {
    const page = (isEditing: boolean) => (
      <SpdPaymentPage
        cashuBalanceAfterMelt={100_000}
        initialOfferContactCount={1}
        initialOfferDelaySec={0}
        isEditing={isEditing}
        offerContacts={[{ id: "contact-a", name: "Alice", npub: "npub1alice" }]}
        onRequestReimbursement={onRequestReimbursement}
        spdPayload={spdPayload}
      />
    );
    const { container, rerender } = await renderIntoDocument(page(false));
    return {
      container,
      render: (isEditing: boolean) => rerender(page(isEditing)),
    };
  };

  const fieldInput = (container: HTMLElement, key: string) => {
    const input = container.querySelector<HTMLInputElement>(
      `#bank-payment-field-${key}`,
    );
    if (!input) throw new Error(`input ${key} missing`);
    return input;
  };

  const rowValues = (container: HTMLElement) =>
    Array.from(container.querySelectorAll(".bank-payment-value")).map(
      (value) => value.textContent,
    );

  it("sends the confirmed edits instead of the scanned fields", async () => {
    const onRequestReimbursement = vi.fn(async () => null);
    const spdPayload =
      "SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK*X-VS:111";
    const { container, render } = await renderEditable(
      spdPayload,
      onRequestReimbursement,
    );

    expect(rowValues(container)).toEqual(["1265098001/5500", "111"]);
    expect(container.querySelector(".bank-payment-recipient")).toBeNull();

    await render(true);

    expect(container.querySelector(".bank-payment-request")).toBeNull();
    expect(container.querySelector(".bank-payment-offer-contact")).toBeNull();
    expect(container.querySelector(".bank-payment-offer-delay")).toBeNull();
    expect(fieldInput(container, "AM").value).toBe("480");
    expect(fieldInput(container, "ACC").value).toBe("1265098001/5500");
    expect(fieldInput(container, "X-VS").value).toBe("111");
    expect(fieldInput(container, "MSG").value).toBe("");
    expect(container.querySelector(".input-public-value")?.textContent).toBe(
      "CZK",
    );

    await act(async () => {
      setInputValue(fieldInput(container, "AM"), "100");
      setInputValue(fieldInput(container, "ACC"), "19-2000145399/0800");
      setInputValue(fieldInput(container, "X-VS"), "222");
      setInputValue(fieldInput(container, "MSG"), "Oběd");
    });

    expect(container.querySelector(".bank-payment-amount")?.textContent).toBe(
      "10000 sat",
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".bank-payment-edit-confirm")
        ?.click();
    });
    expect(navigateTo).toHaveBeenLastCalledWith({
      route: "bankPayment",
      spdPayload,
    });

    await render(false);

    expect(
      Array.from(container.querySelectorAll(".bank-payment-row")).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      "spdPaymentAccount19-2000145399/0800",
      "spdPaymentVariableSymbol222",
      "spdPaymentMessageOběd",
    ]);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".bank-payment-request")
        ?.click();
    });

    expect(onRequestReimbursement).toHaveBeenCalledWith(
      expect.objectContaining({
        amountSat: 10_000,
        spdPayload:
          "SPD*1.0*ACC:CZ6508000000192000145399*AM:100*CC:CZK*X-VS:222*MSG:Ob%C4%9Bd",
      }),
    );
  });

  it("flags invalid account and BIC edits and drops a draft left by navigation", async () => {
    const onRequestReimbursement = vi.fn(async () => null);
    const spdPayload = "SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK";
    const { container, render } = await renderEditable(
      spdPayload,
      onRequestReimbursement,
    );
    await render(true);

    const confirmButton = () =>
      container.querySelector<HTMLButtonElement>(".bank-payment-edit-confirm");
    const errorText = () =>
      container.querySelector(".bank-payment-error")?.textContent ?? null;
    const errorRowInputId = () =>
      container
        .querySelector(".bank-payment-error")
        ?.closest(".bank-payment-edit-row")
        ?.querySelector("input")?.id ?? null;

    await act(async () => {
      setInputValue(fieldInput(container, "ACC"), "");
    });
    expect(errorText()).toBe("spdPaymentMissingAccount");
    expect(errorRowInputId()).toBe("bank-payment-field-ACC");
    expect(confirmButton()?.disabled).toBe(true);

    await act(async () => {
      setInputValue(fieldInput(container, "ACC"), "1234/0800");
    });
    expect(errorText()).toBe("spdPaymentInvalidAccount");
    expect(fieldInput(container, "ACC").getAttribute("aria-invalid")).toBe(
      "true",
    );

    await act(async () => {
      setInputValue(fieldInput(container, "ACC"), "1265098001/5500");
      setInputValue(fieldInput(container, "BIC"), "GIBA");
    });
    expect(errorText()).toBe("spdPaymentInvalidBic");
    expect(errorRowInputId()).toBe("bank-payment-field-BIC");

    await act(async () => {
      setInputValue(fieldInput(container, "AM"), "12,345");
    });
    expect(errorText()).toBe("spdPaymentInvalidAmount");

    // Topbar back / hardware back leave the form without confirming.
    await render(false);

    expect(rowValues(container)).toEqual(["1265098001/5500"]);
    expect(
      container.querySelector<HTMLButtonElement>(".bank-payment-request")
        ?.disabled,
    ).toBe(false);

    await render(true);
    expect(fieldInput(container, "AM").value).toBe("480");
    expect(fieldInput(container, "BIC").value).toBe("");
    await render(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".bank-payment-request")
        ?.click();
    });
    expect(onRequestReimbursement).toHaveBeenCalledWith(
      expect.objectContaining({ spdPayload }),
    );
  });
});
