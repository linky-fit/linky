import type { EvoluError } from "@evolu/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { EvoluDataDetailPage } from "./EvoluDataDetailPage";
import { EvoluServersPage } from "./EvoluServersPage";

const counts = vi.hoisted(() => {
  const state: {
    tables: Record<string, number | null>;
    history: number | null;
    errorType: EvoluError["type"] | null;
    reloadRequired: boolean;
  } = { tables: {}, history: null, errorType: null, reloadRequired: false };
  return state;
});

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({ t: (key: string) => key }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useEvoluSettingsContext: () => ({
    evoluTableCounts: counts.tables,
    evoluErrorType: counts.errorType,
    evoluServersReloadRequired: counts.reloadRequired,
    evoluHistoryCount: counts.history,
    evoluDatabaseBytes: 4096,
    evoluServerUrls: [],
    evoluTransactionsVisibleOwnerIds: [],
  }),
}));

vi.mock("../hooks/useRouting", () => ({
  navigateTo: vi.fn(),
}));

vi.mock("../evolu", () => ({
  loadEvoluCurrentData: vi.fn(),
  loadEvoluHistoryData: vi.fn(),
}));

const rowValue = (container: HTMLElement, label: string): string | null => {
  const row = Array.from(container.querySelectorAll(".settings-row")).find(
    (element) =>
      element.querySelector(".settings-label")?.textContent === label,
  );
  return row?.querySelector(".settings-right")?.textContent ?? null;
};

beforeEach(() => {
  counts.tables = {};
  counts.history = null;
  counts.errorType = null;
  counts.reloadRequired = false;
});

describe("Evolu row counts", () => {
  it("shows a normal reload on the server list after server settings change", async () => {
    counts.reloadRequired = true;
    const view = await renderIntoDocument(<EvoluServersPage />);
    expect(view.container.textContent).toContain("evoluServersReloadHint");
    expect(
      Array.from(view.container.querySelectorAll("button")).some(
        (button) => button.textContent === "evoluServersReloadButton",
      ),
    ).toBe(true);
    await view.unmount();
  });

  it("explains quota failures without claiming the database is empty", async () => {
    counts.errorType = "ProtocolQuotaError";
    counts.tables = { cashuToken: 4 };
    const view = await renderIntoDocument(<EvoluServersPage />);
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(
      "evoluQuotaExceeded",
    );
    expect(rowValue(view.container, "evoluData")).toContain("4 rows");
    const buttons = Array.from(view.container.querySelectorAll("button"));
    expect(
      buttons.find((button) => button.textContent === "evoluClearDatabase")
        ?.disabled,
    ).toBe(true);
    expect(
      buttons.some((button) => button.textContent === "evoluRetrySync"),
    ).toBe(true);
    expect(view.container.textContent).toContain("evoluQuotaRecoveryHint");
    await view.unmount();
  });

  it("distinguishes pending counts from a confirmed empty database", async () => {
    const view = await renderIntoDocument(<EvoluServersPage />);
    expect(rowValue(view.container, "evoluData")).toContain("unknown");
    expect(rowValue(view.container, "evoluHistory")).toContain("unknown");

    counts.tables = { contact: 0, ownerMeta: 0 };
    counts.history = 0;
    await view.rerender(<EvoluServersPage />);
    expect(rowValue(view.container, "evoluData")).toContain("0 rows");
    expect(rowValue(view.container, "evoluHistory")).toContain("0 rows");
    await view.unmount();
  });

  it("does not describe pending detail table counts as no data", async () => {
    const view = await renderIntoDocument(<EvoluDataDetailPage />);
    expect(view.container.textContent).not.toContain("evoluNoDataYet");
    expect(view.container.textContent).toContain("unknown");
    await view.unmount();
  });

  it("does not present partial counts or their percentages as complete totals", async () => {
    counts.tables = { contact: 7, cashuToken: null, ownerMeta: 2 };
    counts.history = 870;
    const servers = await renderIntoDocument(<EvoluServersPage />);
    expect(rowValue(servers.container, "evoluData")).toContain("unknown");
    expect(rowValue(servers.container, "evoluHistory")).toContain("870 rows");
    await servers.unmount();

    const detail = await renderIntoDocument(<EvoluDataDetailPage />);
    expect(rowValue(detail.container, "evoluCurrentDataJson")).toBe("unknown");
    expect(rowValue(detail.container, "evoluTotalRows")).toBe("unknown");
    expect(rowValue(detail.container, "cashuToken")).toBe("unknown");
    expect(rowValue(detail.container, "contact")).toBe("7 rows");
    await detail.unmount();
  });
});
