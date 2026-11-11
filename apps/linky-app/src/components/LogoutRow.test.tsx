import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { LogoutRow } from "./LogoutRow";

const t = (key: string): string => key;

const buttonByText = (text: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === text,
  ) ?? null;

describe("LogoutRow", () => {
  it("logs out only after the user confirms a backup", async () => {
    const onConfirm = vi.fn();
    const { container } = await renderIntoDocument(
      <LogoutRow evoluConnected onConfirm={onConfirm} t={t} />,
    );

    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="logout"]')?.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("logoutConfirmBody");

    await act(async () => {
      buttonByText("logoutConfirmBackedUp")?.click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("offers the keys backup instead of logging out", async () => {
    const onConfirm = vi.fn();
    const onBackUpKeys = vi.fn();
    const { container } = await renderIntoDocument(
      <LogoutRow
        evoluConnected={false}
        onBackUpKeys={onBackUpKeys}
        onConfirm={onConfirm}
        t={t}
      />,
    );

    await act(async () => {
      container.querySelector<HTMLElement>('[data-testid="logout"]')?.click();
    });
    expect(document.body.textContent).toContain("logoutConfirmUnsyncedBody");
    await act(async () => {
      buttonByText("logoutConfirmBackUpFirst")?.click();
    });

    expect(onBackUpKeys).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
