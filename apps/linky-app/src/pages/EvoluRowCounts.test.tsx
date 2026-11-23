import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvoluErrorType } from "../evolu";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { EvoluServersPage } from "./EvoluServersPage";

const counts = vi.hoisted(() => {
  const state: {
    tables: Record<string, number | null>;
    history: number | null;
    errorType: EvoluErrorType | null;
    reloadRequired: boolean;
    servers: string[];
    disabled: string[];
  } = {
    tables: {},
    history: null,
    errorType: null,
    reloadRequired: false,
    servers: [],
    disabled: [],
  };
  return state;
});

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    t: (key) => (key === "evoluRowCount" ? "{count} rows" : key),
  }),
);

vi.mock("../app/hooks/settings/useEvoluSettings", () => ({
  useEvoluErrorType: () => counts.errorType,
  useEvoluReloadRequired: () => counts.reloadRequired,
  useEvoluSettings: () => ({
    evoluTableCounts: counts.tables,
    evoluErrorType: counts.errorType,
    evoluServersReloadRequired: counts.reloadRequired,
    evoluHistoryCount: counts.history,
    evoluDatabaseBytes: 4096,
    evoluServerUrls: counts.servers,
    evoluServerStatusByUrl: {},
    isEvoluServerOffline: (url: string) => counts.disabled.includes(url),
    isEvoluServerRecommended: () => false,
    evoluShards: [],
    evoluSyncOwnerIds: [],
  }),
}));

vi.mock("../hooks/useRouting", () => ({
  navigateTo: vi.fn(),
}));

const evoluMocks = vi.hoisted(() => ({
  requestSync: vi.fn(),
  retryQuotaSync: vi.fn(() => ["owner-1"]),
  syncState: { get: () => null },
}));

vi.mock("../evolu", () => ({
  loadEvoluCurrentData: vi.fn(),
  loadEvoluHistoryData: vi.fn(),
  retryQuotaSync: evoluMocks.retryQuotaSync,
  useLinkyEvolu: () => ({}),
  useOpenedEvolu: () => ({
    evolu: { requestSync: evoluMocks.requestSync },
    run: { deps: { syncState: evoluMocks.syncState } },
    hasEvoluRelay: true,
    memoryOnly: false,
  }),
}));

const rowValue = (container: HTMLElement, label: string): string | null => {
  const row = container.querySelector(`[data-testid="${label}"]`);
  return row?.textContent?.slice(label.length) ?? null;
};

beforeEach(() => {
  counts.tables = {};
  counts.history = null;
  counts.errorType = null;
  counts.reloadRequired = false;
  counts.servers = [];
  counts.disabled = [];
  evoluMocks.retryQuotaSync.mockClear();
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
      buttons
        .find((button) => button.textContent === "evoluClearDatabase")
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    const retryButton = buttons.find(
      (button) => button.textContent === "evoluRetrySync",
    );
    expect(retryButton).toBeDefined();
    expect(view.container.textContent).toContain("evoluQuotaRecoveryHint");
    retryButton?.click();
    expect(evoluMocks.retryQuotaSync).toHaveBeenCalledTimes(1);
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

  it("does not present partial counts as complete totals", async () => {
    counts.tables = { contact: 7, cashuToken: null, ownerMeta: 2 };
    counts.history = 870;
    const servers = await renderIntoDocument(<EvoluServersPage />);
    expect(rowValue(servers.container, "evoluData")).toContain("unknown");
    expect(rowValue(servers.container, "evoluHistory")).toContain("870 rows");
    await servers.unmount();
  });
});

describe("Evolu backup warning", () => {
  it.each([
    { servers: [], disabled: [], warning: true },
    {
      servers: ["wss://sync.example.com"],
      disabled: ["wss://sync.example.com"],
      warning: true,
    },
    { servers: ["wss://sync.example.com"], disabled: [], warning: false },
  ])(
    "shows warning=$warning for $servers with $disabled disabled",
    async ({ servers, disabled, warning }) => {
      counts.servers = servers;
      counts.disabled = disabled;
      const view = await renderIntoDocument(<EvoluServersPage />);
      expect(view.container.textContent?.includes("evoluNoBackupWarning")).toBe(
        warning,
      );
      await view.unmount();
    },
  );
});
