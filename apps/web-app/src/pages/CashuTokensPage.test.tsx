import { createIdFromString } from "@linky/linksync";
import { TokenTransfer } from "@linky/linkshu";
import { Schema } from "effect";
import { act, type ComponentProps } from "react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { en } from "../i18n/en";
import type { I18nKey } from "../i18n";
import { createStoredProofFixture } from "../testUtils/cashuInventory";
import { buildCashuToken } from "../testUtils/cashuToken";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { navigateTo } from "../hooks/useRouting";
import { CashuTokensPage } from "./CashuTokensPage";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    t: (key: I18nKey) => en[key],
    lang: "en",
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
  }),
}));
vi.mock("../hooks/useRouting", () => ({ navigateTo: vi.fn() }));

const transfer = Schema.decodeUnknownSync(TokenTransfer)({
  id: "AQEBAQEBAQEBAQEBAQEBAQ",
  kind: "send",
  status: "issued",
  tokenText: buildCashuToken(),
  mint: "https://mint.example",
  unit: "sat",
  amount: 21,
  error: null,
  createdAt: Math.floor(new Date("2026-09-11T12:00:00Z").getTime() / 1000),
});
const contactId = createIdFromString<"Contact">("alice");
const proof = createStoredProofFixture({
  state: "handedOut",
  amount: 21,
  operationId: transfer.id,
});
const props = (): ComponentProps<typeof CashuTokensPage> => ({
  cashuIsBusy: false,
  canRestoreTokens: true,
  tokensRestoreIsBusy: false,
  tokensRestoreProgress: null,
  restoreMissingTokens: vi.fn(async () => {}),
  cashuBulkCheckIsBusy: false,
  cashuProofs: [proof],
  cashuTransfers: [transfer],
  contacts: [{ id: contactId, name: "Alice" }],
  messages: [],
  checkIssuedCashuTokensAndDeleteClaimed: vi.fn(async () => ({ claimed: [] })),
});

const click = async (container: HTMLElement, text: string) => {
  const button = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(text),
  );
  assert(button !== undefined);
  await act(async () => button.click());
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("pending tokens", () => {
  it("shows amount, state, handoff and age without the creation date, and opens both screens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage {...props()} />,
    );
    expect(container.textContent).toContain("21 sat");
    expect(container.textContent).toContain("Awaiting claim");
    expect(container.textContent).toContain("Issued token");
    expect(container.textContent).not.toContain("Return to wallet");
    expect(container.textContent).toContain("Pending for 3 days");
    expect(container.querySelector("time")).toBeNull();
    expect(container.textContent).not.toContain("Created");
    expect(container.querySelector("table")).toBeNull();
    expect(
      [...container.querySelectorAll("dd")].map((node) => node.textContent),
    ).toEqual(["0 sat", "21 sat"]);
    await click(container, "21 sat");
    expect(navigateTo).toHaveBeenLastCalledWith({
      route: "cashuToken",
      id: transfer.id,
    });
    await click(container, "Inspect proofs");
    expect(navigateTo).toHaveBeenLastCalledWith({ route: "cashuProofs" });
    await unmount();
  });

  it("totals available and outstanding proofs without counting spent, held or failed incoming amounts", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage
        {...props()}
        cashuTransfers={[
          transfer,
          new TokenTransfer({
            ...transfer,
            id: Schema.decodeUnknownSync(TokenTransfer.fields.id)(
              "AgICAgICAgICAgICAgICAg",
            ),
            kind: "receive",
            status: "failed",
          }),
        ]}
        cashuProofs={[
          proof,
          createStoredProofFixture({ amount: 100, state: "available" }),
          createStoredProofFixture({ amount: 4, state: "externalized" }),
          createStoredProofFixture({ amount: 50, state: "spent" }),
          createStoredProofFixture({
            mint: "https://other.example",
            amount: 40,
            state: "available",
          }),
          createStoredProofFixture({
            mint: "https://other.example",
            amount: 3,
            state: "handedOut",
          }),
          createStoredProofFixture({ amount: 6, state: "held" }),
        ]}
      />,
    );
    expect(
      [...container.querySelectorAll("thead th")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Mint", "Available balance", "In pending tokens"]);
    expect(
      [...container.querySelectorAll("tbody tr")].map((row) =>
        [...row.children].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["mint.example", "100 sat", "25 sat"],
      ["other.example", "40 sat", "3 sat"],
    ]);
    expect(
      [...container.querySelectorAll("tfoot td")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["140 sat", "28 sat"]);
    expect(container.querySelectorAll(".cashu-transfer-row")).toHaveLength(1);
    expect(container.textContent).not.toContain("Received token");
    await unmount();
  });

  it("starts missing-token recovery and disables it while busy or without a seed", async () => {
    const pageProps = props();
    const { container, rerender, unmount } = await renderIntoDocument(
      <CashuTokensPage {...pageProps} />,
    );
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    await click(container, "Look for missing tokens");
    expect(pageProps.restoreMissingTokens).toHaveBeenCalledOnce();
    await rerender(<CashuTokensPage {...pageProps} canRestoreTokens={false} />);
    await click(container, "Look for missing tokens");
    expect(pageProps.restoreMissingTokens).toHaveBeenCalledOnce();
    await rerender(
      <CashuTokensPage {...pageProps} tokensRestoreIsBusy={true} />,
    );
    expect(container.textContent).toContain("Looking for missing tokens");
    const progress = container.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-label")).toBe(
      "Looking for missing tokens…",
    );
    expect(progress?.hasAttribute("aria-valuenow")).toBe(false);
    expect(container.textContent).toContain("Loading mint keysets…");
    await rerender(
      <CashuTokensPage
        {...pageProps}
        tokensRestoreIsBusy={true}
        tokensRestoreProgress={{
          phase: "scanning",
          completedKeysets: 3,
          totalKeysets: 6,
          totalMints: 2,
        }}
      />,
    );
    expect(container.textContent).toContain(
      "Scanned 3 of 6 keysets across 2 mints.",
    );
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuenow"),
    ).toBe("3");
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.getAttribute("aria-valuemax"),
    ).toBe("6");
    expect(
      container
        .querySelector('[role="progressbar"] > span')
        ?.getAttribute("style"),
    ).toBe("width: 50%;");
    await rerender(
      <CashuTokensPage
        {...pageProps}
        tokensRestoreIsBusy={true}
        tokensRestoreProgress={{
          phase: "refreshing",
          completedKeysets: 6,
          totalKeysets: 6,
          totalMints: 2,
        }}
      />,
    );
    expect(container.textContent).toContain("Refreshing recovered tokens…");
    expect(
      container
        .querySelector('[role="progressbar"]')
        ?.hasAttribute("aria-valuenow"),
    ).toBe(false);
    await rerender(<CashuTokensPage {...pageProps} />);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    await unmount();
  });

  it("keeps a delivered chat token until its proofs are claimed and links to the recipient", async () => {
    const pageProps = props();
    pageProps.cashuTransfers = [
      new TokenTransfer({ ...transfer, status: "done" }),
    ];
    pageProps.messages = [
      {
        id: "message",
        contactId,
        content: transfer.tokenText,
        createdAtSec: transfer.createdAt,
        direction: "out",
        pubkey: "",
        rumorId: null,
        wrapId: "",
        status: "sent",
      },
    ];
    const { container, rerender, unmount } = await renderIntoDocument(
      <CashuTokensPage {...pageProps} />,
    );
    expect(container.textContent).toContain("Sent in chat · Alice");
    expect(container.textContent).not.toContain("Return to wallet");
    expect(container.textContent).toContain("Awaiting claim");
    await click(container, "Sent in chat");
    expect(navigateTo).toHaveBeenLastCalledWith({
      route: "chat",
      id: contactId,
    });
    await rerender(
      <CashuTokensPage
        {...pageProps}
        cashuProofs={[
          createStoredProofFixture({
            operationId: transfer.id,
            state: "spent",
          }),
        ]}
      />,
    );
    expect(container.textContent).toContain("No open transfers.");
    expect(container.querySelector("li")).toBeNull();
    await unmount();
  });

  it("distinguishes NFC and unknown handoffs, and excludes incoming tokens", async () => {
    const pageProps = props();
    const { container, rerender, unmount } = await renderIntoDocument(
      <CashuTokensPage
        {...pageProps}
        cashuTransfers={[
          new TokenTransfer({ ...transfer, status: "externalized" }),
        ]}
      />,
    );
    expect(container.textContent).toContain("Written to NFC");
    await rerender(
      <CashuTokensPage
        {...pageProps}
        cashuTransfers={[new TokenTransfer({ ...transfer, status: "done" })]}
      />,
    );
    expect(container.textContent).toContain("Handoff unknown");
    expect(container.textContent).not.toContain("Sent in chat");
    for (const status of TokenTransfer.fields.status.literals) {
      await rerender(
        <CashuTokensPage
          {...pageProps}
          cashuTransfers={[
            new TokenTransfer({ ...transfer, kind: "receive", status }),
          ]}
        />,
      );
      expect(container.textContent).toContain("No open transfers.");
      expect(container.querySelector("li")).toBeNull();
      expect(container.textContent).not.toContain("Received token");
    }
    await unmount();
  });

  it("updates elapsed time while open and shows partial claims", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T11:59:00Z"));
    const { container, unmount } = await renderIntoDocument(
      <CashuTokensPage
        {...props()}
        cashuProofs={[
          proof,
          createStoredProofFixture({
            id: "AgICAgICAgICAgICAgICAg",
            amount: 1,
            operationId: transfer.id,
            state: "spent",
          }),
        ]}
      />,
    );
    expect(container.textContent).toContain("Pending for 23 h");
    expect(container.textContent).toContain("Partially claimed");
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(container.textContent).toContain("Pending for 1 day");
    await unmount();
  });
});
