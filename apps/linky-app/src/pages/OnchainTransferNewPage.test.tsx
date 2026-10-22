import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewOnchainTransferDraft } from "../app/lib/onchainTransfers";
import type { OnchainConfigState } from "../app/state/wallet/onchainConfig";
import {
  MAINNET_ADDRESS,
  REGTEST_ADDRESS,
  onchainConfigFixture,
} from "../testUtils/onchainTransfers";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import {
  OnchainTransferForm,
  OnchainTransferNewPage,
  type OnchainSendPrefill,
} from "./OnchainTransferNewPage";

const page = vi.hoisted((): { shown: boolean; config: OnchainConfigState } => ({
  shown: true,
  config: { status: "loading" },
}));

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    ...(await import("../testUtils/onchainTransfers")).EUR_DISPLAY,
    t: (key) =>
      new Map([
        ["onchainTransferFeeNotice", "fee {fee}"],
        ["onchainSendAmountUnavailable", "asks for {amount}"],
      ]).get(key) ?? key,
  }),
);
vi.mock("../app/hooks/useOnchainTransfers", () => ({
  useOnchainConfig: () => page.config,
  useOnchainTransfersShown: () => page.shown,
  useOnchainTransferCommands: () => ({
    contactSupport: vi.fn(),
    requestOnchainTransfer: vi.fn(),
  }),
}));
vi.mock("../app/hooks/wallet/useWalletInventory", () => ({
  useWalletBalance: () => ({ cashuBalanceAfterMelt: 1_000_000 }),
}));

const byTestId = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const press = async (element: Element | null | undefined) => {
  if (!element) throw new Error("nothing to press");
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const typeInto = async (input: HTMLElement | null, value: string) => {
  if (!(input instanceof HTMLInputElement)) throw new Error("no input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const renderForm = async ({
  direction = "send",
  config = onchainConfigFixture(),
  payableSat = 1_000_000,
  prefill = null,
}: {
  direction?: "send" | "receive";
  config?: ReturnType<typeof onchainConfigFixture>;
  payableSat?: number;
  prefill?: OnchainSendPrefill | null;
} = {}) => {
  const onSubmit = vi
    .fn<(draft: NewOnchainTransferDraft) => Promise<boolean>>()
    .mockResolvedValue(true);
  const onContactSupport = vi.fn();
  const { container } = await renderIntoDocument(
    <OnchainTransferForm
      direction={direction}
      config={config}
      payableSat={payableSat}
      prefill={prefill}
      onSubmit={onSubmit}
      onContactSupport={onContactSupport}
    />,
  );
  const amounts = () =>
    Array.from(
      container.querySelectorAll('[data-testid="onchain-transfer-amount"]'),
    );
  const submit = () => byTestId(container, "onchain-transfer-continue");
  return { amounts, container, onContactSupport, onSubmit, submit };
};

describe("OnchainTransferForm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers the fixed amounts in the display unit and sats, and adds the service fee on top in exact sats", async () => {
    const { amounts, container } = await renderForm({
      config: onchainConfigFixture({
        amounts: [100_000, 250_000],
        feeBasisPoints: 150,
      }),
    });
    expect(container.textContent).toContain("onchainSendFixedAmounts");
    expect(amounts().map((row) => row.textContent)).toEqual([
      expect.stringContaining("~100 EUR100,000 sat"),
      expect.stringContaining("~250 EUR250,000 sat"),
    ]);
    expect(byTestId(container, "onchain-transfer-total")).toBeNull();

    await press(amounts()[1]);
    expect(container.textContent).toContain(
      "onchainTransferYouGet250,000 sat (~250 EUR)",
    );
    expect(container.textContent).toContain(
      "onchainTransferServiceFee (1.5%)3,750 sat (~4 EUR)",
    );
    expect(byTestId(container, "onchain-transfer-total")?.textContent).toBe(
      "onchainSendYouPay253,750 sat (~254 EUR)",
    );
    expect(container.textContent).toContain("onchainSendNetworkFeeAmount");
  });

  it("offers only the amounts the balance pays, the service fee included", async () => {
    const { amounts, container } = await renderForm({ payableSat: 101_000 });
    expect(
      amounts().map((row) => row.getAttribute("aria-disabled") === "true"),
    ).toEqual([false, true, true, true]);
    expect(amounts()[1]?.textContent).toContain("250,000 sat");
    expect(amounts()[1]?.textContent).toContain("payInsufficient");
    expect(container.textContent).not.toContain("onchainSendInsufficient");

    document.body.innerHTML = "";
    const poor = await renderForm({ payableSat: 100_999 });
    expect(poor.container.textContent).toContain("onchainSendInsufficient");
  });

  it("starts an on-chain send to a scanned address of the config's network", async () => {
    const { amounts, container, onSubmit, submit } = await renderForm({
      prefill: { payoutAddress: MAINNET_ADDRESS, amount: 250_000 },
    });
    expect(amounts()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("onchainTransferAddressInvalid");
    expect(submit()?.getAttribute("aria-disabled")).toBe("true");

    await typeInto(
      byTestId(container, "onchain-transfer-payoutAddress"),
      REGTEST_ADDRESS,
    );
    expect(container.textContent).not.toContain(
      "onchainTransferAddressInvalid",
    );
    await press(submit());
    expect(onSubmit).toHaveBeenCalledWith({
      direction: "send",
      amount: 250_000,
      payoutAddress: REGTEST_ADDRESS,
      refundAddress: "",
      refundToSender: true,
    });
  });

  it("warns about a scanned amount that is not a fixed one and continues only once the user confirms checking with the recipient", async () => {
    const { amounts, container, onSubmit, submit } = await renderForm({
      prefill: { payoutAddress: REGTEST_ADDRESS, amount: 123_000 },
    });
    const confirm = () => container.querySelector('[role="switch"]');
    expect(
      amounts().some((row) => row.getAttribute("aria-selected") === "true"),
    ).toBe(false);
    expect(container.textContent).toContain("asks for 123,000 sat (~123 EUR)");

    await press(amounts()[0]);
    expect(submit()?.getAttribute("aria-disabled")).toBe("true");
    await press(confirm());
    expect(confirm()?.getAttribute("aria-checked")).toBe("true");
    await press(submit());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100_000 }),
    );

    document.body.innerHTML = "";
    const fixed = await renderForm({
      prefill: { payoutAddress: REGTEST_ADDRESS, amount: 100_000 },
    });
    expect(fixed.container.textContent).not.toContain("asks for");
    expect(fixed.submit()?.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("refunds an on-chain receive to the sender unless the user picks another address, both ways without losing it", async () => {
    const { amounts, container, onSubmit, submit } = await renderForm({
      direction: "receive",
    });
    const sender = () => byTestId(container, "onchain-transfer-refund-sender");
    const custom = () => byTestId(container, "onchain-transfer-custom-refund");
    expect(sender()?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("onchainReceiveCustodialWarning");
    expect(byTestId(container, "onchain-transfer-refundAddress")).toBeNull();
    await press(amounts()[0]);
    expect(byTestId(container, "onchain-transfer-total")?.textContent).toBe(
      "onchainReceiveYouSend101,000 sat (~101 EUR)",
    );

    await press(custom());
    expect(submit()?.getAttribute("aria-disabled")).toBe("true");
    await typeInto(
      byTestId(container, "onchain-transfer-refundAddress"),
      REGTEST_ADDRESS,
    );
    await press(sender());
    expect(byTestId(container, "onchain-transfer-refundAddress")).toBeNull();
    expect(submit()?.getAttribute("aria-disabled")).not.toBe("true");
    await press(custom());
    const refundField = byTestId(container, "onchain-transfer-refundAddress");
    expect(refundField instanceof HTMLInputElement && refundField.value).toBe(
      REGTEST_ADDRESS,
    );
    await press(submit());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "receive",
        amount: 100_000,
        refundAddress: REGTEST_ADDRESS,
        refundToSender: false,
      }),
    );
  });

  it("says how long it takes and what it costs before confirming, with a way to support", async () => {
    const { container, onContactSupport } = await renderForm({
      direction: "receive",
    });
    expect(container.textContent).toContain("onchainReceiveArrivalNotice");
    expect(container.textContent).toContain("onchainReceiveNetworkFee");
    expect(container.textContent).toContain("fee 1%");
    await press(
      Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "onchainTransferContactSupport",
      ),
    );
    expect(onContactSupport).toHaveBeenCalledOnce();
  });
});

describe("OnchainTransferNewPage", () => {
  beforeEach(() => {
    vi.stubGlobal("__APP_VERSION__", "26.10.1");
    page.shown = true;
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it.each<[string, boolean, OnchainConfigState, string, readonly string[]]>([
    ["hidden", false, { status: "loading" }, "onchainTransferUnavailable", []],
    ["loading", true, { status: "loading" }, "loading", []],
    [
      "unavailable",
      true,
      { status: "unavailable" },
      "onchainTransferUnavailable",
      [],
    ],
    [
      "paused",
      true,
      { status: "ready", config: onchainConfigFixture({ paused: true }) },
      "onchainTransferPaused",
      ["onchainTransferContactSupport"],
    ],
    [
      "too old",
      true,
      {
        status: "ready",
        config: onchainConfigFixture({ minClientVersion: "26.11.0" }),
      },
      "onchainTransferUpdateRequired",
      ["pwaUpdateButton", "onchainTransferContactSupport"],
    ],
  ])("explains when it is %s", async (_case, shown, config, copy, actions) => {
    page.shown = shown;
    page.config = config;
    const { container } = await renderIntoDocument(
      <OnchainTransferNewPage direction="send" prefill={null} />,
    );
    expect(container.textContent).toContain(copy);
    for (const action of actions)
      expect(container.textContent).toContain(action);
    expect(byTestId(container, "onchain-transfer-amount")).toBeNull();
  });
});
