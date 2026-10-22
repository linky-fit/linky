import { TokenTransfer, WalletBalances } from "@linky-fit/linkshu";
import { UIProvider } from "@linky-fit/ui";
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
  issueToken: Mock;
  takeBack: Mock<(id: string) => Promise<TakeBackOutcome>>;
  quote: Mock;
} = vi.hoisted(() => ({
  issued: [],
  issueToken: vi.fn(),
  takeBack: vi.fn<(id: string) => Promise<TakeBackOutcome>>(),
  quote: vi.fn(),
}));

vi.mock("../services/react", () => ({
  useAppServices: () => ({
    config: { mintUrl: mint },
    wallet: {
      issueToken: state.issueToken,
      takeBack: state.takeBack,
      checkClaims: () => Promise.resolve(),
    },
    lightning: { quote: state.quote },
  }),
  useWalletBalance: () =>
    Schema.decodeUnknownSync(WalletBalances)({
      total: 500,
      spendable: 500,
      perMint: [{ mint, amount: 500 }],
    }),
  useIssuedTokens: () => state.issued,
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
  state.issueToken.mockReset();
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

it("issues a token only for a whole amount the mint holds, then shows it with the spend warning", async () => {
  state.issueToken.mockResolvedValue(Result.succeed({ tokenText: token }));
  await render();
  await press("wallet-send-token");

  await typeInto("send-token-amount", "1.5");
  await press("send-token-create");
  expect(sheetText("send-token-sheet")).toContain(
    "A whole number of sats above zero.",
  );

  await typeInto("send-token-amount", "501");
  await press("send-token-create");
  expect(sheetText("send-token-sheet")).toContain(
    "The mint holds only 500 sat in this wallet.",
  );
  expect(state.issueToken).not.toHaveBeenCalled();

  await typeInto("send-token-amount", "21");
  await press("send-token-create");
  expect(state.issueToken).toHaveBeenCalledWith(mint, 21);
  expect(sheetText("send-token-sheet")).toContain(
    "Whoever holds this token can spend it",
  );
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

it("asks for an invoice or address before quoting, and an amount for an address", async () => {
  await render();
  await press("wallet-pay-lightning");

  await press("pay-lightning-review");
  expect(sheetText("pay-lightning-sheet")).toContain(
    "Paste a Lightning invoice or a Lightning address.",
  );

  await typeInto("pay-lightning-target", "bc1qnotlightning");
  expect(sheetText("pay-lightning-sheet")).toContain(
    "Paste a Lightning invoice or a Lightning address.",
  );

  await typeInto("pay-lightning-target", "alice@example.com");
  await press("pay-lightning-review");
  expect(sheetText("pay-lightning-sheet")).toContain(
    "A whole number of sats above zero.",
  );
  expect(state.quote).not.toHaveBeenCalled();
});
