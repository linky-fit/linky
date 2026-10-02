import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX } from "../utils/constants";
import { addToClaimInbox } from "../utils/npubCashClaimInbox";
import { PushDebugPage } from "./PushDebugPage";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({ currentNsec: null, t: (key: string) => key }),
}));

describe("PushDebugPage", () => {
  afterEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("copies a report that lists a queued npub.cash claim but not its token", async () => {
    const token = "cashuBqueuedclaimnobodymayredeem";
    addToClaimInbox(`${LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX}.owner`, [
      token,
    ]);
    const writeText = vi.fn<(text: string) => Promise<void>>();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { container, unmount } = await renderIntoDocument(<PushDebugPage />);
    await vi.waitFor(() =>
      expect(container.querySelector("pre")?.textContent).toContain(
        LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX,
      ),
    );

    const copyLogs = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Copy logs",
    );
    await act(async () => copyLogs?.click());

    const [report] = writeText.mock.calls[0] ?? [];
    expect(report).toContain(LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX);
    expect(report).not.toContain(token);
    await unmount();
  });
});
