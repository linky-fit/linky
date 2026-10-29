import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NewOnchainTransferDraft,
  OnchainTransferView,
} from "../app/lib/onchainTransfers";
import type { OnchainConfigState } from "../app/state/wallet/onchainConfig";
import {
  MAINNET_ADDRESS,
  REGTEST_ADDRESS,
  onchainConfigFixture,
  onchainTransferViewFixture,
} from "../testUtils/onchainTransfers";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import {
  OnchainReceiveIntro,
  OnchainSendForm,
  OnchainTransferNewPage,
  type OnchainSendPrefill,
} from "./OnchainTransferNewPage";

const page = vi.hoisted(
  (): {
    shown: boolean;
    config: OnchainConfigState;
    transfers: readonly OnchainTransferView[];
    requestOnchainTransfer: ReturnType<typeof vi.fn>;
    navigateTo: ReturnType<typeof vi.fn>;
  } => ({
    shown: true,
    config: { status: "loading" },
    transfers: [],
    requestOnchainTransfer: vi.fn(),
    navigateTo: vi.fn(),
  }),
);

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    t: (key) =>
      new Map([
        ["onchainSendFeeCaption", "+ {fee} fee"],
        ["onchainSendMinimum", "at least {min}"],
        ["onchainSendAmountUnavailable", "asks for {amount}"],
        ["onchainReceiveIntroRange", "from {min} to {max}"],
        ["onchainReceiveIntroFee", "fee {fee}"],
      ]).get(key) ?? key,
  }),
);
vi.mock("../app/hooks/useOnchainTransfers", () => ({
  useOnchainConfig: () => page.config,
  useOnchainTransfersShown: () => page.shown,
  useOnchainTransfers: () => page.transfers,
  useOnchainTransferCommands: () => ({
    contactSupport: vi.fn(),
    requestOnchainTransfer: page.requestOnchainTransfer,
  }),
}));
vi.mock("../app/hooks/wallet/useWalletInventory", () => ({
  useWalletBalance: () => ({ cashuBalanceAfterMelt: 1_000_000 }),
}));
vi.mock("../hooks/useRouting", () => ({ navigateTo: page.navigateTo }));

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

const renderSendForm = async ({
  config = onchainConfigFixture(),
  payableSat = 1_000_000,
  prefill = null,
}: {
  config?: ReturnType<typeof onchainConfigFixture>;
  payableSat?: number;
  prefill?: OnchainSendPrefill | null;
} = {}) => {
  const onSubmit = vi
    .fn<(draft: NewOnchainTransferDraft) => Promise<boolean>>()
    .mockResolvedValue(true);
  const { container } = await renderIntoDocument(
    <OnchainSendForm
      config={config}
      payableSat={payableSat}
      prefill={prefill}
      onSubmit={onSubmit}
    />,
  );
  const amount = () => byTestId(container, "onchain-transfer-amount");
  const fee = () => byTestId(container, "onchain-transfer-fee");
  const up = () => byTestId(container, "onchain-transfer-amount-up");
  const down = () => byTestId(container, "onchain-transfer-amount-down");
  const submit = () => byTestId(container, "onchain-transfer-continue");
  const disabled = (element: HTMLElement | null) =>
    element?.getAttribute("aria-disabled") === "true";
  return { amount, container, disabled, down, fee, onSubmit, submit, up };
};

describe("OnchainSendForm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the largest amount the balance pays with the fee on top, and steps it among the operator's amounts", async () => {
    const { amount, container, disabled, down, fee, up } =
      await renderSendForm();
    expect(container.textContent).toContain("onchainSendArrivalNotice");
    // 1,000,000 sat plus 1 % is out of reach; 500,000 plus 1 % is the most.
    expect(amount()?.textContent).toContain("500000");
    expect(fee()?.textContent).toBe("+ 5000 sat fee");
    expect(disabled(up())).toBe(true);
    expect(disabled(down())).toBe(false);
    expect(byTestId(container, "onchain-transfer-total")).toBeNull();

    await press(down());
    expect(amount()?.textContent).toContain("250000");
    expect(fee()?.textContent).toBe("+ 2500 sat fee");
    await press(down());
    expect(amount()?.textContent).toContain("100000");
    expect(disabled(down())).toBe(true);
    await press(up());
    expect(amount()?.textContent).toContain("250000");
  });

  it("tells the least a send takes when the balance pays no amount", async () => {
    const { amount, container, disabled, submit } = await renderSendForm({
      payableSat: 100_999,
    });
    expect(amount()).toBeNull();
    expect(container.textContent).toContain("at least 101000 sat");
    expect(disabled(submit())).toBe(true);
  });

  it("sends a scanned amount to a scanned address of the config's network", async () => {
    const { amount, container, disabled, onSubmit, submit } =
      await renderSendForm({
        prefill: { payoutAddress: MAINNET_ADDRESS, amount: 250_000 },
      });
    expect(amount()?.textContent).toContain("250000");
    expect(container.textContent).toContain("onchainTransferAddressInvalid");
    expect(disabled(submit())).toBe(true);

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
    });
    expect(disabled(submit())).toBe(true);
  });

  it("warns about a scanned amount the send cannot be made for and continues only once the user confirms checking with the recipient", async () => {
    const { amount, container, disabled, onSubmit, submit } =
      await renderSendForm({
        prefill: { payoutAddress: REGTEST_ADDRESS, amount: 123_000 },
      });
    const confirm = () => container.querySelector('[role="switch"]');
    expect(container.textContent).toContain("asks for 123000 sat");
    expect(amount()?.textContent).toContain("500000");
    expect(disabled(submit())).toBe(true);

    await press(confirm());
    expect(confirm()?.getAttribute("aria-checked")).toBe("true");
    await press(submit());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500_000 }),
    );

    document.body.innerHTML = "";
    const fixed = await renderSendForm({
      prefill: { payoutAddress: REGTEST_ADDRESS, amount: 100_000 },
    });
    expect(fixed.container.textContent).not.toContain("asks for");
    expect(fixed.amount()?.textContent).toContain("100000");
    expect(fixed.disabled(fixed.submit())).toBe(false);
  });
});

describe("OnchainReceiveIntro", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("explains the wait, the limits in the display unit, the fee and the refund before showing the address", async () => {
    const onShowAddress = vi.fn();
    const { container } = await renderIntoDocument(
      <OnchainReceiveIntro
        config={onchainConfigFixture({
          minReceiveAmount: 100_000,
          maxReceiveAmount: 2_000_000,
          feeBasisPoints: 150,
        })}
        busy={false}
        onShowAddress={onShowAddress}
      />,
    );
    expect(container.textContent).toContain("onchainReceiveIntroSettlement");
    // The shell mock's display unit writes amounts as "<n> sat"; exact sats would read "100,000 sat".
    expect(container.textContent).toContain("from 100000 sat to 2000000 sat");
    expect(container.textContent).toContain("fee 1.5%");
    expect(container.textContent).toContain("onchainReceiveIntroRefund");
    expect(container.textContent).not.toContain("onchainTransferRefundAddress");
    await press(byTestId(container, "onchain-receive-show-address"));
    expect(onShowAddress).toHaveBeenCalledOnce();
  });

  it("is unavailable under an operator taking no receive of any amount", async () => {
    const { container } = await renderIntoDocument(
      <OnchainReceiveIntro
        config={onchainConfigFixture({ minReceiveAmount: undefined })}
        busy={false}
        onShowAddress={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("onchainTransferUnavailable");
    expect(byTestId(container, "onchain-receive-show-address")).toBeNull();
  });
});

describe("OnchainTransferNewPage", () => {
  beforeEach(() => {
    vi.stubGlobal("__APP_VERSION__", "26.10.1");
    page.shown = true;
    page.transfers = [];
    page.requestOnchainTransfer.mockReset();
    page.navigateTo.mockReset();
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

  it("requests a receive of any amount, or opens the one still waiting for its deposit", async () => {
    page.config = { status: "ready", config: onchainConfigFixture() };
    page.requestOnchainTransfer.mockResolvedValue(true);
    const { container } = await renderIntoDocument(
      <OnchainTransferNewPage direction="receive" prefill={null} />,
    );
    await press(byTestId(container, "onchain-receive-show-address"));
    expect(page.requestOnchainTransfer).toHaveBeenCalledWith(
      { direction: "receive", amount: null, payoutAddress: "" },
      onchainConfigFixture(),
    );

    document.body.innerHTML = "";
    const open = onchainTransferViewFixture({
      direction: "receive",
      anyAmount: true,
      phase: "awaitingDeposit",
      depositAddress: REGTEST_ADDRESS,
    });
    page.transfers = [open];
    page.requestOnchainTransfer.mockClear();
    const again = await renderIntoDocument(
      <OnchainTransferNewPage direction="receive" prefill={null} />,
    );
    await press(byTestId(again.container, "onchain-receive-show-address"));
    expect(page.requestOnchainTransfer).not.toHaveBeenCalled();
    expect(page.navigateTo).toHaveBeenCalledWith({
      route: "onchainTransfer",
      id: open.id,
    });
  });
});
