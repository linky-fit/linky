import type { RecurringPaymentOrder } from "@linky-fit/recurring-payment";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contactIdFor,
  recurringOrderFixture,
  recurringPaymentIdFor,
} from "../testUtils/recurringOrders";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { SupporterDonatePage } from "./SupporterDonatePage";

const linkyBot = contactIdFor("linky-bot");
const createdId = recurringPaymentIdFor("created");

let orders: RecurringPaymentOrder[] = [];

const mocks = vi.hoisted(() => ({
  createRecurringPayment: vi.fn(),
  navigateTo: vi.fn(),
  payContactFromMint: vi.fn(),
  payNow: vi.fn(),
}));

vi.mock("../hooks/useRouting", () => ({ navigateTo: mocks.navigateTo }));
vi.mock("../devtools/inspector/appLog", () => ({ reportAppLog: vi.fn() }));
vi.mock("../components/SupporterBadgeDisplayOptions", () => ({
  SupporterBadgeDisplayOptions: () => null,
}));
vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    cashuIsBusy: false,
    lang: "en",
    t: (key: string) => key,
  }),
}));
vi.mock("../app/context/SystemSettingsContexts", () => ({
  useMintSettingsContext: () => ({ allowTestMints: false }),
}));
vi.mock("../app/context/RecurringPaymentsContext", () => ({
  useRecurringPaymentsContext: () => ({
    createRecurringPayment: mocks.createRecurringPayment,
    payNow: mocks.payNow,
  }),
}));
vi.mock("../app/context/SupporterContext", () => ({
  useSupporterContext: () => ({
    mintBalances: [{ mint: "https://cashu.cz", amount: 100_000 }],
    payContactFromMint: mocks.payContactFromMint,
  }),
}));
vi.mock("../app/hooks/useLinksync", () => ({
  useSupporterAwardRecords: () => [],
}));
vi.mock("../app/hooks/payments/useRecurringPaymentOrders", () => ({
  useRecurringPaymentOrders: () => orders,
}));

const findButton = (container: HTMLElement, text: string) => {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button missing: ${text}`);
  }
  return button;
};

const press = async (button: HTMLButtonElement): Promise<void> => {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("SupporterDonatePage", () => {
  beforeEach(() => {
    orders = [];
    mocks.createRecurringPayment.mockResolvedValue(createdId);
    mocks.payNow.mockResolvedValue(false);
    mocks.payContactFromMint.mockResolvedValue(true);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("counts a created monthly payment as set up even when its first run waits", async () => {
    const { container } = await renderIntoDocument(
      <SupporterDonatePage contactId={linkyBot} />,
    );

    await press(findButton(container, "donateConfirmMonthly"));
    expect(mocks.createRecurringPayment).toHaveBeenCalledTimes(1);
    expect(mocks.payNow).toHaveBeenCalledWith(createdId);
    expect(container.textContent).toContain("donateMonthlySetUp");

    await press(findButton(container, "donateConfirmMonthly"));
    expect(mocks.createRecurringPayment).toHaveBeenCalledTimes(1);

    await press(findButton(container, "donateShowMonthly"));
    expect(mocks.navigateTo).toHaveBeenCalledWith({
      route: "recurringPayment",
      id: createdId,
    });
  });

  it("points to the running monthly payment instead of creating a second one", async () => {
    const running = recurringOrderFixture({ contactId: linkyBot });
    orders = [running];
    const { container } = await renderIntoDocument(
      <SupporterDonatePage contactId={linkyBot} />,
    );

    expect(container.textContent).toContain("donateMonthlyRunning");
    await press(findButton(container, "donateConfirmMonthly"));
    expect(mocks.createRecurringPayment).not.toHaveBeenCalled();

    await press(findButton(container, "donateShowMonthly"));
    expect(mocks.navigateTo).toHaveBeenCalledWith({
      route: "recurringPayment",
      id: running.id,
    });
  });
});
