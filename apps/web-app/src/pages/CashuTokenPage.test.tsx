import { buildCashuToken } from "../testUtils/cashuToken";
import type { LocalNostrMessage } from "../app/types/appTypes";
import { navigateTo } from "../hooks/useRouting";
import { TokenTransfer } from "@linky/linkshu";
import { Schema } from "effect";
import { act, type ComponentProps } from "react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { CashuOperationId, ContactId } from "@linky/linksync";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ANIMATED_QR_FRAME_MS } from "../utils/animatedQr";
import { CashuTokenPage } from "./CashuTokenPage";
import { createStoredProofFixture } from "../testUtils/cashuInventory";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    t: (key: string) => key,
    allowedDisplayCurrencies: ["sat"],
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
    formatDisplayedAmountParts: (amount: number) => ({
      approxPrefix: "",
      amountText: String(amount),
      unitLabel: "sat",
    }),
  }),
  useAppShellActions: () => ({ cycleDisplayCurrency: vi.fn() }),
}));

vi.mock("../hooks/useRouting", () => ({ navigateTo: vi.fn() }));

const tokenOf = (length: number) =>
  `cashuB${"o2FtcGh0dHBzOi8vY2FzaHUuY3phdWNzYXRhdIGiYWlIAbqH8lOtAF9hcI".repeat(60)}`.slice(
    0,
    length,
  );

const props = (tokenText: string): ComponentProps<typeof CashuTokenPage> => ({
  contacts: [],
  messages: [],
  reclaimCashuTransfer: vi.fn(async () => {}),
  inspectCashuProofStates: null,
  canSendToContact: false,
  canWriteToNfc: false,
  cashuIsBusy: false,
  cashuProofs: [],
  cashuTransfers: [
    Schema.decodeUnknownSync(TokenTransfer)({
      id: "AQEBAQEBAQEBAQEBAQEBAQ",
      kind: "send",
      status: "issued",
      tokenText,
      mint: "https://mint.example",
      unit: "sat",
      amount: 21,
      error: null,
      createdAt: 1,
    }),
  ],
  checkAndRefreshCashuToken: async () => "ok",
  checkSingleIssuedCashuTokenIsClaimed: async () => false,
  copyText: vi.fn(),
  pendingCashuDeleteId: null,
  requestDeleteCashuToken: vi.fn(),
  returnCashuTokenToWallet: async () => {},
  routeId: CashuOperationId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ"),
  shareTokenText: async () => {},
  showPaidOverlay: vi.fn(),
  startSendCashuTokenToContact: async () => {},
  writeToNfc: async () => {},
});

const waitFor = async (check: () => void) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    try {
      check();
      return;
    } catch (error) {
      if (attempt === 39) throw error;
    }
  }
};
const imageSource = (container: HTMLElement) =>
  container.querySelector("img.qr")?.getAttribute("src");
const revealQr = async (container: HTMLElement) => {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === "cashuShowTokenQr",
  );
  assert(button !== undefined);
  await act(async () => button.click());
};
const toggle = async (container: HTMLElement) => {
  const input = container.querySelector(
    'input[aria-label="cashuTokenAnimateQr"]',
  );
  assert(input instanceof HTMLInputElement);
  await act(async () => input.click());
  return input;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("token QR animation toggle", () => {
  it("hides the QR section until revealed and hides it again on another token", async () => {
    const pageProps = props(tokenOf(2200));
    const rendered = await renderIntoDocument(
      <CashuTokenPage {...pageProps} />,
    );
    const expectHidden = () => {
      expect(imageSource(rendered.container)).toBeUndefined();
      expect(
        rendered.container.querySelector('input[type="checkbox"]'),
      ).toBeNull();
      expect(rendered.container.textContent).not.toContain(
        "cashuTokenAnimatedQrHint",
      );
      expect(rendered.container.textContent).toContain("cashuShowTokenQr");
      expect(rendered.container.textContent).toContain("cashuReturnToWallet");
    };
    try {
      expectHidden();
      await revealQr(rendered.container);
      await waitFor(() => expect(imageSource(rendered.container)).toBeTruthy());
      expect(rendered.container.textContent).toContain(
        "cashuTokenAnimatedQrHint",
      );
      const transfer = pageProps.cashuTransfers[0];
      assert(transfer !== undefined);
      const nextId = CashuOperationId.orThrow("AgICAgICAgICAgICAgICAg");
      await rendered.rerender(
        <CashuTokenPage
          {...pageProps}
          routeId={nextId}
          cashuTransfers={[
            Schema.decodeUnknownSync(TokenTransfer)({
              ...transfer,
              id: nextId,
            }),
          ]}
        />,
      );
      expectHidden();
      await rendered.rerender(<CashuTokenPage {...pageProps} />);
      expectHidden();
    } finally {
      await rendered.unmount();
    }
  });

  it("replaces the animation with a stable QR of the complete token and can re-enable it", async () => {
    const token = tokenOf(2200);
    const QRCode = await import("qrcode");
    const fullTokenQr: string = await QRCode.toDataURL(token, {
      errorCorrectionLevel: "M",
      margin: 2,
    });
    const rendered = await renderIntoDocument(
      <CashuTokenPage {...props(token)} />,
    );
    try {
      await revealQr(rendered.container);
      await waitFor(() => expect(imageSource(rendered.container)).toBeTruthy());
      const firstFrame = imageSource(rendered.container);
      await waitFor(() =>
        expect(imageSource(rendered.container)).not.toBe(firstFrame),
      );
      const input = await toggle(rendered.container);
      expect(input.checked).toBe(false);
      await waitFor(() =>
        expect(imageSource(rendered.container)).toBe(fullTokenQr),
      );
      await act(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, ANIMATED_QR_FRAME_MS * 2),
        );
      });
      expect(imageSource(rendered.container)).toBe(fullTokenQr);
      expect(rendered.container.textContent).not.toContain(
        "cashuTokenAnimatedQrHint",
      );
      await toggle(rendered.container);
      await waitFor(() => {
        expect(imageSource(rendered.container)).toBeTruthy();
        expect(imageSource(rendered.container)).not.toBe(fullTokenQr);
      });
      expect(input.checked).toBe(true);
    } finally {
      await rendered.unmount();
    }
  });

  it("explains when one static QR cannot fit and allows animation again", async () => {
    const rendered = await renderIntoDocument(
      <CashuTokenPage {...props(tokenOf(3000))} />,
    );
    try {
      await revealQr(rendered.container);
      await waitFor(() => expect(imageSource(rendered.container)).toBeTruthy());
      await toggle(rendered.container);
      await waitFor(() => {
        expect(imageSource(rendered.container)).toBeUndefined();
        expect(rendered.container.textContent).toContain(
          "cashuTokenStaticQrUnavailable",
        );
      });
      await toggle(rendered.container);
      await waitFor(() => expect(imageSource(rendered.container)).toBeTruthy());
      expect(rendered.container.textContent).not.toContain(
        "cashuTokenStaticQrUnavailable",
      );
    } finally {
      await rendered.unmount();
    }
  });

  it("keeps small tokens static without an animation toggle", async () => {
    const rendered = await renderIntoDocument(
      <CashuTokenPage {...props(tokenOf(300))} />,
    );
    try {
      await revealQr(rendered.container);
      await waitFor(() => expect(imageSource(rendered.container)).toBeTruthy());
      expect(
        rendered.container.querySelector('input[type="checkbox"]'),
      ).toBeNull();
    } finally {
      await rendered.unmount();
    }
  });
});

describe("claimable token actions", () => {
  it.each<TokenTransfer["status"]>(["issued", "pending", "externalized"])(
    "offers return instead of delete for a %s send",
    async (status) => {
      const pageProps = props(tokenOf(300));
      const transfer = pageProps.cashuTransfers[0];
      assert(transfer !== undefined);
      const returnToWallet = vi.fn(async () => {});
      const rendered = await renderIntoDocument(
        <CashuTokenPage
          {...pageProps}
          cashuTransfers={[new TokenTransfer({ ...transfer, status })]}
          cashuProofs={[
            createStoredProofFixture({
              operationId: pageProps.routeId,
              state: status === "externalized" ? "externalized" : "handedOut",
            }),
          ]}
          returnCashuTokenToWallet={returnToWallet}
        />,
      );
      try {
        const buttons = [...rendered.container.querySelectorAll("button")];
        expect(buttons.some((button) => button.textContent === "delete")).toBe(
          false,
        );
        const returnButton = buttons.find(
          (button) => button.textContent === "cashuReturnToWallet",
        );
        assert(returnButton !== undefined);
        await act(async () => returnButton.click());
        expect(returnToWallet).toHaveBeenCalledWith(pageProps.routeId);
      } finally {
        await rendered.unmount();
      }
    },
  );

  it("does not offer delete for unknown or partially spent proofs", async () => {
    const pageProps = props(tokenOf(300));
    const rendered = await renderIntoDocument(
      <CashuTokenPage {...pageProps} />,
    );
    try {
      expect(
        [...rendered.container.querySelectorAll("button")].some(
          (b) => b.textContent === "delete",
        ),
      ).toBe(false);
      await rendered.rerender(
        <CashuTokenPage
          {...pageProps}
          cashuProofs={[
            createStoredProofFixture({
              operationId: pageProps.routeId,
              amount: 10,
              state: "spent",
            }),
            createStoredProofFixture({
              id: "AgICAgICAgICAgICAgICAg",
              operationId: pageProps.routeId,
              amount: 11,
              state: "handedOut",
            }),
          ]}
        />,
      );
      expect(
        [...rendered.container.querySelectorAll("button")].some(
          (b) => b.textContent === "delete",
        ),
      ).toBe(false);
    } finally {
      await rendered.unmount();
    }
  });

  it("only offers delete once all associated proofs are recorded spent", async () => {
    const pageProps = props(tokenOf(300));
    const rendered = await renderIntoDocument(
      <CashuTokenPage
        {...pageProps}
        cashuProofs={[
          createStoredProofFixture({
            operationId: pageProps.routeId,
            amount: 21,
            state: "spent",
          }),
        ]}
      />,
    );
    try {
      const buttons = [...rendered.container.querySelectorAll("button")];
      expect(buttons.some((b) => b.textContent === "delete")).toBe(true);
      expect(buttons.some((b) => b.textContent === "cashuReturnToWallet")).toBe(
        false,
      );
    } finally {
      await rendered.unmount();
    }
  });
});

it("shows the creation timestamp on token detail", async () => {
  const pageProps = props(tokenOf(100));
  const createdAt = Math.floor(
    new Date("2026-09-11T12:00:00Z").getTime() / 1000,
  );
  const { container, unmount } = await renderIntoDocument(
    <CashuTokenPage
      {...pageProps}
      cashuTransfers={[
        new TokenTransfer({
          ...pageProps.cashuTransfers[0],
          createdAt: Schema.decodeUnknownSync(TokenTransfer.fields.createdAt)(
            createdAt,
          ),
        }),
      ]}
    />,
  );
  expect(container.querySelector("time")?.dateTime).toBe(
    "2026-09-11T12:00:00.000Z",
  );
  expect(container.textContent).toContain("cashuCreated");
  expect(container.textContent).toContain("cashuHandoffIssued");
  await unmount();
});

it("shows chat handoff and the return action on a delivered token's detail", async () => {
  const baseProps = props(buildCashuToken());
  const transfer = new TokenTransfer({
    ...baseProps.cashuTransfers[0],
    status: "done",
  });
  const contactId = ContactId.orThrow("AgICAgICAgICAgICAgICAg");
  const messages: LocalNostrMessage[] = [
    {
      id: "chat-message",
      contactId,
      content: transfer.tokenText,
      createdAtSec: 1,
      direction: "out",
      pubkey: "",
      rumorId: null,
      wrapId: "",
      status: "sent",
    },
  ];
  const reclaimCashuTransfer = vi.fn(async () => {});
  const pageProps = {
    ...baseProps,
    cashuTransfers: [transfer],
    cashuProofs: [
      createStoredProofFixture({
        operationId: transfer.id,
        state: "handedOut",
        amount: 21,
      }),
    ],
    contacts: [{ id: contactId, name: "Alice" }],
    messages,
    reclaimCashuTransfer,
  };
  const { container, rerender, unmount } = await renderIntoDocument(
    <CashuTokenPage {...pageProps} />,
  );
  const returnButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "cashuReturnToWallet",
  );
  assert(returnButton !== undefined);
  expect(container.textContent).toContain("cashuSentInChat · Alice");
  expect(container.textContent).toContain("cashuAwaitingClaim");
  await act(async () => returnButton.click());
  expect(reclaimCashuTransfer).toHaveBeenCalledExactlyOnceWith(transfer.id);
  const chatButton = container.querySelector(".cashu-transfer-chat");
  assert(chatButton instanceof HTMLButtonElement);
  await act(async () => chatButton.click());
  expect(navigateTo).toHaveBeenLastCalledWith({ route: "chat", id: contactId });
  await rerender(<CashuTokenPage {...pageProps} cashuIsBusy={true} />);
  expect(returnButton.disabled).toBe(true);
  await rerender(
    <CashuTokenPage
      {...pageProps}
      cashuProofs={[
        createStoredProofFixture({
          operationId: transfer.id,
          state: "spent",
          amount: 21,
        }),
      ]}
    />,
  );
  expect(
    [...container.querySelectorAll("button")].some(
      (button) => button.textContent === "cashuReturnToWallet",
    ),
  ).toBe(false);
  await unmount();
});

it("shows a reclaimed token label after return and preserves known chat provenance", async () => {
  const pageProps = props(buildCashuToken());
  const transfer = new TokenTransfer({
    ...pageProps.cashuTransfers[0],
    status: "returned",
  });
  const returnedProps = { ...pageProps, cashuTransfers: [transfer] };
  const { container, rerender, unmount } = await renderIntoDocument(
    <CashuTokenPage {...returnedProps} />,
  );
  try {
    expect(container.textContent).toContain("cashuHandoffReclaimed");
    expect(container.textContent).toContain("cashuTransferReturned");
    expect(container.textContent).not.toContain("cashuHandoffUnknown");
    const contactId = ContactId.orThrow("AgICAgICAgICAgICAgICAg");
    await rerender(
      <CashuTokenPage
        {...returnedProps}
        contacts={[{ id: contactId, name: "Alice" }]}
        messages={[
          {
            id: "chat-message",
            contactId,
            content: transfer.tokenText,
            createdAtSec: 1,
            direction: "out",
            pubkey: "",
            rumorId: null,
            wrapId: "",
            status: "sent",
          },
        ]}
      />,
    );
    expect(container.textContent).toContain("cashuSentInChat · Alice");
    expect(container.textContent).toContain("cashuTransferReturned");
    expect(container.textContent).not.toContain("cashuHandoffUnknown");
  } finally {
    await unmount();
  }
});
