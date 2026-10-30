import { UIProvider } from "@linky-fit/ui";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoApp } from "./DemoApp";
import { LocaleProvider } from "../LocaleProvider";
import { DemoProvider } from "./DemoProvider";

let root: Root | undefined;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

/** The network the page talks to: the rate service and the support account's Lightning address. */
const fakeFetch = (input: RequestInfo | URL): Promise<Response> => {
  const url = String(input);
  if (url.includes("yadio.io")) {
    return Promise.resolve(
      json({ BTC: { BRL: 1, CHF: 1, CZK: 2_000_000, EUR: 1, USD: 1 } }),
    );
  }
  if (url.includes("/.well-known/lnurlp/")) {
    return Promise.resolve(
      json({
        callback: "https://linky.fit/callback",
        minSendable: 1000,
        maxSendable: 1_000_000_000,
        tag: "payRequest",
      }),
    );
  }
  if (url.startsWith("https://linky.fit/callback?amount=")) {
    return Promise.resolve(json({ pr: "lnbc2500n1testinvoice", routes: [] }));
  }
  return Promise.reject(new Error(`Unexpected fetch ${url}`));
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const renderPhones = async () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <UIProvider mode="dark" brand="fazole">
        <LocaleProvider locale="cs" onLocaleChange={() => {}}>
          <DemoProvider>
            <DemoApp accessibilityLabel="Telefon s terminálem" maxWidth={320} />
            <DemoApp accessibilityLabel="Telefon s historií" maxWidth={320} />
          </DemoProvider>
        </LocaleProvider>
      </UIProvider>,
    ),
  );
  const phone = (label: string) => {
    const element = container.querySelector<HTMLElement>(
      `[aria-label="${label}"]`,
    );
    if (!element) throw new Error(`No phone "${label}"`);
    return element;
  };
  const history = phone("Telefon s historií");
  await press(history, "Historie");
  return { terminal: phone("Telefon s terminálem"), history };
};

const press = async (phone: HTMLElement, name: string | RegExp) => {
  const button = [
    ...phone.querySelectorAll<HTMLElement>("button, [role=radio]"),
  ].find((element) => {
    const label = element.getAttribute("aria-label") ?? element.textContent;
    return typeof name === "string" ? label === name : name.test(label ?? "");
  });
  if (!button) throw new Error(`No button "${String(name)}"`);
  await act(async () => button.click());
};

/** Lets the fetches the screen started resolve and their state land. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => Promise.resolve());
};

describe("the live terminal", () => {
  it("adds the chosen tip, announces the bank payment on the terminal and records it in the shared history", async () => {
    const { terminal, history } = await renderPhones();
    for (const key of ["1", "2", "0"]) await press(terminal, key);
    await press(terminal, "Potvrdit");
    expect(terminal.textContent).toContain("Chcete přidat spropitné?");
    await press(terminal, /^10 %/u);
    expect(terminal.textContent).toContain("283078181/0600");
    await press(terminal, "Zaplaceno");
    const banner = terminal.querySelector('[role="status"]')?.textContent;
    expect(banner).toContain("Zaplaceno");
    expect(banner).toContain("132");
    expect(terminal.textContent).toContain("Potvrdit");
    expect(history.textContent).toContain("Banka · z toho spropitné 12 Kč");
  });

  it("shows a payable Bitcoin QR code for the amount at the live rate and takes the merchant's confirmation", async () => {
    const { terminal } = await renderPhones();
    await settle();
    await press(terminal, "5");
    await press(terminal, "Potvrdit");
    await press(terminal, /^Bez spropitného/u);
    await press(terminal, "Bitcoin");
    await settle();
    // 5 Kč at 2 000 000 Kč/BTC is 250 sat, asked from the Lightning address in millisats.
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "https://linky.fit/callback?amount=250000",
      expect.anything(),
    );
    expect(
      terminal.querySelector('[aria-label="QR kód pro platbu 5 Kč bitcoinem"]'),
    ).not.toBeNull();
    expect(terminal.textContent).toContain("250 sat");
    expect(terminal.textContent).toContain("Čekám na platbu…");
    await press(terminal, "Zaplaceno");
    const banner = terminal.querySelector('[role="status"]')?.textContent;
    expect(banner).toContain("Zaplaceno");
    expect(banner).toContain("5");
  });
});
