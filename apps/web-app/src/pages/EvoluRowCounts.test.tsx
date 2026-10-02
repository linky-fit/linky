import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvoluErrorType } from "../evolu";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { EvoluDataDetailPage } from "./EvoluDataDetailPage";
import { EvoluRelaysPage } from "./EvoluRelaysPage";

const counts = vi.hoisted(() => {
  const state: {
    tables: Record<string, number | null>;
    history: number | null;
    errorType: EvoluErrorType | null;
    reloadRequired: boolean;
    relays: string[];
    disabled: string[];
  } = {
    tables: {},
    history: null,
    errorType: null,
    reloadRequired: false,
    relays: [],
    disabled: [],
  };
  return state;
});

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({ t: (key: string) => key }),
}));

vi.mock("../app/context/SystemSettingsContexts", () => ({
  useEvoluSettingsContext: () => ({
    evoluTableCounts: counts.tables,
    evoluErrorType: counts.errorType,
    evoluRelaysReloadRequired: counts.reloadRequired,
    evoluHistoryCount: counts.history,
    evoluDatabaseBytes: 4096,
    evoluRelayUrls: counts.relays,
    evoluRelayStatusByUrl: {},
    isEvoluRelayOffline: (url: string) => counts.disabled.includes(url),
    isEvoluRelayRecommended: () => false,
    evoluShards: [],
    evoluSyncOwnerIds: [],
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
  counts.relays = [];
  counts.disabled = [];
});

describe("Evolu row counts", () => {
  it("shows a normal reload on the relay list after relay settings change", async () => {
    counts.reloadRequired = true;
    const view = await renderIntoDocument(<EvoluRelaysPage />);
    expect(view.container.textContent).toContain("evoluRelaysReloadHint");
    expect(
      Array.from(view.container.querySelectorAll("button")).some(
        (button) => button.textContent === "evoluRelaysReloadButton",
      ),
    ).toBe(true);
    await view.unmount();
  });

  it("explains quota failures without claiming the database is empty", async () => {
    counts.errorType = "ProtocolQuotaError";
    counts.tables = { cashuToken: 4 };
    const view = await renderIntoDocument(<EvoluRelaysPage />);
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
    const view = await renderIntoDocument(<EvoluRelaysPage />);
    expect(rowValue(view.container, "evoluData")).toContain("unknown");
    expect(rowValue(view.container, "evoluHistory")).toContain("unknown");

    counts.tables = { contact: 0, ownerMeta: 0 };
    counts.history = 0;
    await view.rerender(<EvoluRelaysPage />);
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
    const relays = await renderIntoDocument(<EvoluRelaysPage />);
    expect(rowValue(relays.container, "evoluData")).toContain("unknown");
    expect(rowValue(relays.container, "evoluHistory")).toContain("870 rows");
    await relays.unmount();

    const detail = await renderIntoDocument(<EvoluDataDetailPage />);
    expect(rowValue(detail.container, "evoluCurrentDataJson")).toBe("unknown");
    expect(rowValue(detail.container, "evoluTotalRows")).toBe("unknown");
    expect(rowValue(detail.container, "cashuToken")).toBe("unknown");
    expect(rowValue(detail.container, "contact")).toBe("7 rows");
    await detail.unmount();
  });
});

describe("Evolu backup warning", () => {
  it.each([
    { relays: [], disabled: [], warning: true },
    {
      relays: ["wss://sync.example.com"],
      disabled: ["wss://sync.example.com"],
      warning: true,
    },
    { relays: ["wss://sync.example.com"], disabled: [], warning: false },
  ])(
    "shows warning=$warning for $relays with $disabled disabled",
    async ({ relays, disabled, warning }) => {
      counts.relays = relays;
      counts.disabled = disabled;
      const view = await renderIntoDocument(<EvoluRelaysPage />);
      expect(view.container.textContent?.includes("evoluNoBackupWarning")).toBe(
        warning,
      );
      await view.unmount();
    },
  );
});
