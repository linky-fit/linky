import { UIProvider } from "@linky-fit/ui";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoApp } from "./DemoApp";
import { DemoProvider } from "./DemoProvider";
import { BITCOIN_ARRIVES_AFTER_MS } from "./screens/PaymentMock";
import { livePayer } from "./store";

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const renderPhones = async () => {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <UIProvider mode="dark" brand="fazole">
        <DemoProvider>
          <DemoApp
            start="terminal"
            accessibilityLabel="Telefon s terminálem"
            maxWidth={320}
          />
          <DemoApp
            start="history"
            accessibilityLabel="Telefon s historií"
            maxWidth={320}
          />
        </DemoProvider>
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
  return {
    terminal: phone("Telefon s terminálem"),
    history: phone("Telefon s historií"),
  };
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

describe("the live terminal", () => {
  it("adds the chosen tip and records the bank payment in the shared history", async () => {
    const { terminal, history } = await renderPhones();
    for (const key of ["1", "2", "0"]) await press(terminal, key);
    await press(terminal, "Požadovat platbu");
    expect(terminal.textContent).toContain("Chcete přidat spropitné?");
    await press(terminal, /^10 %/u);
    expect(terminal.textContent).toContain("123456789/0000");
    await press(terminal, "Zaplaceno");
    expect(terminal.querySelector('[role="status"]')?.textContent).toContain(
      "Banka · ",
    );
    expect(history.textContent).toContain("Banka · z toho spropitné 12 Kč");
  });

  it("confirms a Bitcoin payment by itself and shows who paid", async () => {
    vi.useFakeTimers();
    const { terminal } = await renderPhones();
    await press(terminal, "5");
    await press(terminal, "Požadovat platbu");
    await press(terminal, /^Bez spropitného/u);
    await press(terminal, "Bitcoin");
    expect(terminal.textContent).toContain("Čekám na platbu…");
    await act(async () => vi.advanceTimersByTime(BITCOIN_ARRIVES_AFTER_MS));
    const overlay = terminal.querySelector('[role="status"]')?.textContent;
    expect(overlay).toContain(livePayer.name);
    expect(overlay).toContain("Cashu · ");
  });
});
