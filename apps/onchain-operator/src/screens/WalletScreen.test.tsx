import { TokenTransfer, WalletBalances } from "@linky-fit/linkshu";
import { UIProvider } from "@linky-fit/ui";
import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Result, Schema } from "effect";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import type { TakeBackOutcome } from "../services/wallet";
import { WalletScreen } from "./WalletScreen";

const mint = "http://localhost:3338";
const token = "cashuBtesttoken";

const state: {
  issued: readonly TokenTransfer[];
  czkPerBtc: number | null;
  resolveName: Mock;
  sendCashu: Mock;
  takeBack: Mock<(id: string) => Promise<TakeBackOutcome>>;
  quote: Mock;
  onchainSat: number | null | "loading";
  onchainWallet: { balance: () => Promise<number | null> };
} = vi.hoisted(() => ({
  onchainSat: null,
  // Stable like the real services, since the screen reads again whenever it changes.
  onchainWallet: {
    balance: () =>
      state.onchainSat === "loading"
        ? new Promise<never>(() => undefined)
        : Promise.resolve(state.onchainSat),
  },
  issued: [],
  czkPerBtc: null,
  resolveName: vi.fn(),
  sendCashu: vi.fn(),
  takeBack: vi.fn<(id: string) => Promise<TakeBackOutcome>>(),
  quote: vi.fn(),
}));

vi.mock("../services/react", () => ({
  useAppServices: () => ({
    config: { mintUrl: mint },
    wallet: {
      takeBack: state.takeBack,
      checkClaims: () => Promise.resolve(),
    },
    lightning: { quote: state.quote },
    onchainWallet: state.onchainWallet,
    cashuSends: { resolveName: state.resolveName, send: state.sendCashu },
  }),
  useWalletBalance: () =>
    Schema.decodeUnknownSync(WalletBalances)({
      total: 500,
      spendable: 500,
      perMint: [{ mint, amount: 500 }],
    }),
  useIssuedTokens: () => state.issued,
}));

vi.mock("../platform/czkRate", () => ({
  useCzkPerBtc: () => state.czkPerBtc,
}));

const issuedToken = Schema.decodeUnknownSync(TokenTransfer)({
  id: "send-1",
  kind: "send",
  status: "issued",
  tokenText: token,
  mint,
  unit: "sat",
  amount: 21,
  error: null,
  createdAt: 1_700_000_000,
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(async () => {
  state.issued = [];
  state.onchainSat = null;
  state.czkPerBtc = null;
  state.resolveName.mockReset();
  state.sendCashu.mockReset();
  state.takeBack.mockReset();
  state.quote.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

const render = () =>
  act(() =>
    root.render(
      <UIProvider mode="dark">
        <WalletScreen />
      </UIProvider>,
    ),
  );

const byTestId = (testId: string) => {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  if (element === null) throw new Error(`no ${testId}`);
  return element;
};

const press = (testId: string) =>
  act(async () => {
    byTestId(testId).click();
  });

const typeInto = (testId: string, text: string) =>
  act(async () => {
    const field = byTestId(testId);
    const input =
      field instanceof HTMLInputElement ? field : field.querySelector("input");
    if (input === null) throw new Error(`no input in ${testId}`);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

const sheetText = (testId: string) => byTestId(testId).textContent ?? "";

it("totals Cashu and the on-chain wallet, and shows each below, in sats or CZK", async () => {
  state.onchainSat = 1_500;
  state.czkPerBtc = 2_000_000;
  await render();
  expect(byTestId("wallet-total").textContent).toBe("2 000 sat");
  expect(byTestId("wallet-cashu").textContent).toContain("500 sat");
  expect(byTestId("wallet-onchain").textContent).toContain("1 500 sat");

  await press("wallet-total");
  expect(byTestId("wallet-total").textContent).toBe("40 CZK");
  expect(byTestId("wallet-onchain").textContent).toContain("30 CZK");

  await press("wallet-total");
  expect(byTestId("wallet-total").textContent).toBe("2 000 sat");
});

it("shows the on-chain row while its balance loads, and none without a key", async () => {
  state.onchainSat = "loading";
  await render();
  expect(byTestId("wallet-onchain").textContent).toContain("…");
  await act(() => root.unmount());
  root = createRoot(container);
  state.onchainSat = null;
  await render();
  expect(document.querySelector('[data-testid="wallet-onchain"]')).toBeNull();
});

it("sends Cashu to an npub as a token after review", async () => {
  const { pubkey } = makeIdentity();
  state.sendCashu.mockResolvedValue(Result.succeed(undefined));
  await render();
  await press("wallet-send");
  await typeInto("send-target", encodeNpub(pubkey));
  await typeInto("send-amount", "21");
  await press("send-review");
  await press("send-cashu");
  expect(state.sendCashu).toHaveBeenCalledWith(
    { pubkey, relays: [] },
    expect.objectContaining({ sats: 500 }),
    21,
  );
  expect(sheetText("send-sheet")).toContain("Sent 21 sat to npub1");
});

it("looks up a Linky name before sending, and says when there is none", async () => {
  state.resolveName.mockResolvedValue(Result.fail({ reason: "nameNotFound" }));
  await render();
  await press("wallet-send");
  await typeInto("send-target", "hynek");
  await typeInto("send-amount", "21");
  await press("send-review");
  expect(state.resolveName).toHaveBeenCalledWith("hynek");
  expect(sheetText("send-sheet")).toContain(
    "Linky has no account of that name.",
  );
  expect(state.sendCashu).not.toHaveBeenCalled();
});

it.each([
  ["returned", "21 sat is back in the wallet."],
  ["claimed", "The recipient already claimed this token."],
  ["mintUnreachable", "The mint is not responding; try again."],
] as const)(
  "takes a sent token back and says how it went (%s)",
  async (outcome, message) => {
    state.issued = [issuedToken];
    state.takeBack.mockResolvedValue(outcome);
    await render();
    await press("wallet-take-back");
    expect(state.takeBack).toHaveBeenCalledWith("send-1");
    expect(byTestId("wallet-screen").textContent).toContain(message);
  },
);

it("asks for a recipient before quoting, and an amount for a Lightning address", async () => {
  await render();
  await press("wallet-send");

  await press("send-review");
  expect(sheetText("send-sheet")).toContain(
    "Enter an npub, a Linky name, a Lightning invoice or a Lightning address.",
  );

  await typeInto("send-target", "bc1qnotlightning?");
  expect(sheetText("send-sheet")).toContain(
    "Enter an npub, a Linky name, a Lightning invoice or a Lightning address.",
  );

  await typeInto("send-target", "alice@example.com");
  await press("send-review");
  expect(sheetText("send-sheet")).toContain(
    "A whole number of sats above zero.",
  );
  expect(state.quote).not.toHaveBeenCalled();
});
