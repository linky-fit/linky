import { UIProvider } from "@linky-fit/ui";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { TransferField } from "./TransferField";

it("keeps a full transaction id selectable inside a shrinking field with copy and explorer actions", async () => {
  const value = "ab".repeat(32);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <UIProvider mode="dark">
          <TransferField
            label="Transaction"
            value={value}
            href={`https://explorer.example/tx/${value}`}
          />
        </UIProvider>,
      );
    });
    const text = Array.from(container.querySelectorAll("*")).find(
      (node) => node.children.length === 0 && node.textContent === value,
    );
    if (text === undefined) throw new Error("missing transaction id");
    expect(getComputedStyle(text).minWidth).toBe("0px");
    expect(
      container.querySelector('[aria-label="Copy Transaction"]'),
    ).not.toBeNull();
    expect(container.querySelector("a")?.href).toBe(
      `https://explorer.example/tx/${value}`,
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
