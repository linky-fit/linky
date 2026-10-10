// @vitest-environment jsdom
import { UIProvider } from "@linky-fit/ui";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard } from "../clipboard";
import DemoAuthPage from "./DemoAuthPage";
import type { DemoAuthState } from "./useDemoAuth";

const demo = vi.hoisted(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = (media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  const initial: { state: DemoAuthState; signerAppUrl: string | undefined } = {
    state: { status: "starting" },
    signerAppUrl: undefined,
  };
  return {
    ...initial,
    retry: vi.fn(),
    logOut: vi.fn(),
  };
});

vi.mock("./useDemoAuth", () => ({ useDemoAuth: () => demo }));
vi.mock("./config", () => ({
  get callbackUrl() {
    return `${location.origin}/demo/auth/`;
  },
  get signerAppUrl() {
    return demo.signerAppUrl;
  },
}));
vi.mock("../clipboard", () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(true),
}));
vi.mock("../SiteLayout", () => ({
  SiteLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../useSiteLocale", () => ({
  useSiteLocale: () => ["en", vi.fn()],
}));

let container: HTMLDivElement;
let root: Root;

const render = async () => {
  await act(async () => {
    root.render(
      <UIProvider mode="dark">
        <DemoAuthPage />
      </UIProvider>,
    );
  });
};

const toggle = async () => {
  const control = container.querySelector<HTMLButtonElement>(
    '[role="switch"][aria-label="Use nightly"]',
  );
  expect(control).not.toBeNull();
  await act(async () => control?.click());
};

const expectLinks = async (origin: string, nonce = "A".repeat(43)) => {
  const openLink = container.querySelector<HTMLAnchorElement>(
    '[data-testid="demo-auth-open-linky"]',
  );
  expect(openLink).not.toBeNull();
  const openUrl = new URL(openLink?.href ?? "");
  expect(openUrl.origin).toBe(origin);
  const openParams = new URLSearchParams(
    openUrl.hash.slice("#linkauth?".length),
  );
  expect(openParams.get("n")).toBe(nonce);
  expect(openParams.get("cb")).toBe(`${location.origin}/demo/auth/`);

  const copy = container.querySelector<HTMLButtonElement>(
    '[data-testid="demo-auth-copy-link"]',
  );
  expect(copy).not.toBeNull();
  await act(async () => copy?.click());
  const copied = vi.mocked(copyTextToClipboard).mock.lastCall?.[0];
  const qrUrl = new URL(copied ?? "");
  expect(qrUrl.origin).toBe(origin);
  const qrParams = new URLSearchParams(qrUrl.hash.slice("#linkauth?".length));
  expect(qrParams.get("n")).toBe(nonce);
  expect(qrParams.has("cb")).toBe(false);
};

beforeEach(async () => {
  demo.state = {
    status: "waiting",
    nonce: "A".repeat(43),
    uri: null,
    connectOtherSigner: vi.fn(),
  };
  demo.signerAppUrl = undefined;
  vi.clearAllMocks();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("Linky build selection", () => {
  it("starts on nightly and switches both links without changing the nonce", async () => {
    expect(
      container.querySelector('[role="switch"]')?.getAttribute("aria-checked"),
    ).toBe("true");
    await expectLinks("https://nightly.app.linky.fit");
    const nightlyQr = container.querySelector(
      '[data-testid="demo-auth-qr"]',
    )?.innerHTML;

    await toggle();
    expect(
      container.querySelector('[role="switch"]')?.getAttribute("aria-checked"),
    ).toBe("false");
    expect(container.textContent).toContain("Released app");
    await expectLinks("https://app.linky.fit");
    expect(
      container.querySelector('[data-testid="demo-auth-qr"]')?.innerHTML,
    ).not.toBe(nightlyQr);

    await toggle();
    await expectLinks("https://nightly.app.linky.fit");
    expect(
      container.querySelector('[data-testid="demo-auth-qr"]')?.innerHTML,
    ).toBe(nightlyQr);
  });

  it("keeps the selected build after retrying a login", async () => {
    await toggle();
    demo.state = { status: "error" };
    await render();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    const retry = container.querySelector<HTMLButtonElement>(
      '[data-testid="demo-auth-retry"]',
    );
    await act(async () => retry?.click());
    expect(demo.retry).toHaveBeenCalledOnce();

    demo.state = {
      status: "waiting",
      nonce: "B".repeat(43),
      uri: null,
      connectOtherSigner: vi.fn(),
    };
    await render();
    await expectLinks("https://app.linky.fit", "B".repeat(43));
  });

  it("preserves the local development override for either selection", async () => {
    demo.signerAppUrl = "http://localhost:5176";
    await render();
    await expectLinks("http://localhost:5176");
    await toggle();
    await expectLinks("http://localhost:5176");
  });
});
