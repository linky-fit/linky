import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    brlPerBtc: 1_000_000,
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

const byTestId = <T extends Element = HTMLElement>(
  container: HTMLElement,
  testId: string,
) => Array.from(container.querySelectorAll<T>(`[data-testid="${testId}"]`));

const buttonByText = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  ) ?? null;

const isDisabled = (button: Element | null | undefined) =>
  button?.getAttribute("aria-disabled") === "true";

const requestButton = (container: HTMLElement) =>
  byTestId<HTMLButtonElement>(container, "bank-payment-request")[0] ?? null;

const delayStepper = (container: HTMLElement) =>
  container.querySelector(
    '[role="group"][aria-label="bankPaymentOfferStaggerDelay"]',
  );

const translate = (key: string): string => {
  if (key === "spdPaymentRequestReimbursementCountOther") {
    return "Ask {count} contacts to pay";
  }
  return key;
};

const stubLocks = (value: object | undefined) =>
  Object.defineProperty(navigator, "locks", { configurable: true, value });

describe("SpdPaymentPage offer recipients", () => {
  beforeEach(() => {
    stubLocks({ query: async () => ({ held: [], pending: [] }) });
  });

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
        isManualEntry={false}
        offerContacts={[
          { id: "a", name: "Alice", npub: "npub1alice" },
          { id: "b", name: "Bob", npub: "npub1bob" },
          { id: "c", name: "Carol", npub: "npub1carol" },
        ]}
        onRequestReimbursement={onRequestReimbursement}
        spdPayload="SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK"
      />,
    );

    const contactButtons = byTestId<HTMLButtonElement>(
      container,
      "bank-payment-offer-contact",
    );
    expect(
      contactButtons.map((button) => button.getAttribute("aria-pressed")),
    ).toEqual(["true", "true", "false"]);
    const request = requestButton(container);
    const firstContact = contactButtons[0];
    expect(
      request &&
        firstContact &&
        Boolean(request.compareDocumentPosition(firstContact) & 4),
    ).toBe(true);

    await act(async () => {
      contactButtons[1]?.click();
      contactButtons[2]?.click();
    });

    // The delay stepper moves in 5 s increments and travels with the offer.
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="bankPaymentOfferStaggerDelayIncrease"]',
        )
        ?.click();
    });

    await act(async () => {
      request?.click();
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
        isManualEntry={false}
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
      byTestId(container, "bank-payment-offer-contact").map(
        (button) =>
          button.querySelector(
            '[data-testid="bank-payment-offer-contact-order"]',
          )?.textContent ?? null,
      );

    expect(readOrders()).toEqual(["1", "2", "3"]);

    const contactButtons = byTestId(container, "bank-payment-offer-contact");

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

    expect(delayStepper(container)?.textContent).toBe("5 s");
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
        isManualEntry={false}
        offerContacts={[{ id: "contact-a", name: "Alice", npub: "npub1alice" }]}
        onRequestReimbursement={onRequestReimbursement}
        spdPayload="SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK"
      />,
    );

    await act(async () => {
      requestButton(container)?.click();
    });

    expect(navigateTo).toHaveBeenCalledWith({
      route: "bankPaymentOffer",
      chatId: "contact-a",
      offerId: "offer-1",
    });
  });

  it("sends without cross-tab locks only after the user accepts the risk", async () => {
    stubLocks(undefined);
    const onRequestReimbursement = vi.fn(async () => null);

    const { container } = await renderIntoDocument(
      <SpdPaymentPage
        cashuBalanceAfterMelt={100_000}
        initialOfferContactCount={1}
        initialOfferDelaySec={0}
        isEditing={false}
        isManualEntry={false}
        offerContacts={[{ id: "contact-a", name: "Alice", npub: "npub1alice" }]}
        onRequestReimbursement={onRequestReimbursement}
        spdPayload="SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK"
      />,
    );

    const warning = () =>
      Array.from(container.querySelectorAll('[role="status"]')).find(
        (element) =>
          element.textContent?.includes("spdPaymentSingleTabWarningTitle"),
      );
    expect(requestButton(container)).toBeNull();
    // Accepting the risk is the only way past the warning.
    expect(warning()?.querySelectorAll("button")).toHaveLength(1);

    await act(async () => {
      buttonByText(container, "spdPaymentSingleTabContinue")?.click();
    });
    expect(onRequestReimbursement).not.toHaveBeenCalled();
    expect(warning()).toBeUndefined();

    await act(async () => {
      requestButton(container)?.click();
    });
    expect(onRequestReimbursement).toHaveBeenCalledWith(
      expect.objectContaining({ singleTabRiskAccepted: true }),
    );
  });

  it("shows each candidate's recent offer outcomes as dots", async () => {
    const { container } = await renderIntoDocument(
      <SpdPaymentPage
        cashuBalanceAfterMelt={100_000}
        initialOfferContactCount={1}
        initialOfferDelaySec={0}
        isEditing={false}
        isManualEntry={false}
        offerContacts={[
          {
            id: "contact-a",
            name: "Alice",
            npub: "npub1alice",
            recentBankPaymentOfferOutcomes: ["unaccepted", "settled", "canceled"],
          },
          { id: "contact-b", name: "Bob", npub: "npub1bob" },
        ]}
        onRequestReimbursement={async () => null}
        spdPayload="SPD*1.0*ACC:CZ5855000000001265098001*AM:480*CC:CZK"
      />,
    );

    const rows = byTestId(container, "bank-payment-offer-contact-outcomes");
    expect(rows).toHaveLength(1);
    expect(
      Array.from(rows[0]?.querySelectorAll('[role="img"]') ?? [], (dot) =>
        dot.getAttribute("aria-label"),
      ),
    ).toEqual([
      "spdPaymentOutcomeUnaccepted",
      "spdPaymentOutcomeSettled",
      "spdPaymentOutcomeCanceled",
    ]);
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
        isManualEntry={false}
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
    byTestId(container, "bank-payment-row").map(
      (row) => row.lastElementChild?.textContent,
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

    await render(true);

    expect(requestButton(container)).toBeNull();
    expect(byTestId(container, "bank-payment-offer-contact")).toHaveLength(0);
    expect(delayStepper(container)).toBeNull();
    expect(fieldInput(container, "AM").value).toBe("480");
    expect(fieldInput(container, "ACC").value).toBe("1265098001/5500");
    expect(fieldInput(container, "X-VS").value).toBe("111");
    expect(fieldInput(container, "MSG").value).toBe("");
    expect(fieldInput(container, "AM").parentElement?.textContent).toBe("CZK");

    await act(async () => {
      setInputValue(fieldInput(container, "AM"), "100");
      setInputValue(fieldInput(container, "ACC"), "19-2000145399/0800");
      setInputValue(fieldInput(container, "X-VS"), "222");
      setInputValue(fieldInput(container, "MSG"), "Oběd");
    });

    expect(
      container.querySelector('[data-testid="bank-payment-amount"]')
        ?.textContent,
    ).toBe("10000 sat");

    await act(async () => {
      buttonByText(container, "spdPaymentEditConfirm")?.click();
    });
    expect(navigateTo).toHaveBeenLastCalledWith({
      route: "bankPayment",
      spdPayload,
    });

    await render(false);

    expect(
      byTestId(container, "bank-payment-row").map((row) => row.textContent),
    ).toEqual([
      "spdPaymentAccount19-2000145399/0800",
      "spdPaymentVariableSymbol222",
      "spdPaymentMessageOběd",
    ]);

    await act(async () => {
      requestButton(container)?.click();
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
      buttonByText(container, "spdPaymentEditConfirm");
    const error = () => container.querySelector('[role="alert"]');
    const errorText = () => error()?.textContent ?? null;
    const errorRowInputId = () =>
      container.querySelector(`[aria-describedby="${error()?.id}"]`)?.id ??
      null;

    await act(async () => {
      setInputValue(fieldInput(container, "ACC"), "");
    });
    expect(errorText()).toBe("spdPaymentMissingAccount");
    expect(errorRowInputId()).toBe("bank-payment-field-ACC");
    expect(isDisabled(confirmButton())).toBe(true);

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
    expect(isDisabled(requestButton(container))).toBe(false);

    await render(true);
    expect(fieldInput(container, "AM").value).toBe("480");
    expect(fieldInput(container, "BIC").value).toBe("");
    await render(false);

    await act(async () => {
      requestButton(container)?.click();
    });
    expect(onRequestReimbursement).toHaveBeenCalledWith(
      expect.objectContaining({ spdPayload }),
    );
  });
});

describe("SpdPaymentPage manual entry", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    navigateTo.mockClear();
  });

  it("builds an SPD payload from the typed fields and opens it as a bank payment", async () => {
    const { container } = await renderIntoDocument(
      <SpdPaymentPage
        cashuBalanceAfterMelt={100_000}
        initialOfferContactCount={1}
        initialOfferDelaySec={0}
        isEditing={true}
        isManualEntry={true}
        offerContacts={[]}
        onRequestReimbursement={async () => null}
        spdPayload=""
      />,
    );

    const confirm = buttonByText(container, "spdPaymentEditConfirm");
    if (!confirm) throw new Error("confirm button missing");
    expect(isDisabled(confirm)).toBe(true);
    // An empty form is not an error until the user starts typing.
    expect(container.querySelector('[role="alert"]')).toBeNull();

    const currency = container.querySelector<HTMLSelectElement>(
      'select[aria-label="spdPaymentCurrency"]',
    );
    if (!currency) throw new Error("currency select missing");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      setter?.call(currency, "EUR");
      currency.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const amount = container.querySelector<HTMLInputElement>(
      "#bank-payment-field-AM",
    );
    if (!amount) throw new Error("amount input missing");
    await act(async () => {
      setInputValue(amount, "12.50");
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "spdPaymentMissingAccount",
    );

    const account = container.querySelector<HTMLInputElement>(
      "#bank-payment-field-ACC",
    );
    if (!account) throw new Error("account input missing");
    await act(async () => {
      setInputValue(account, "CZ5855000000001265098001");
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(isDisabled(confirm)).toBe(false);

    await act(async () => {
      confirm.click();
    });
    expect(navigateTo).toHaveBeenCalledWith({
      route: "bankPayment",
      spdPayload: "SPD*1.0*CC:EUR*AM:12.50*ACC:CZ5855000000001265098001",
    });
  });
});
