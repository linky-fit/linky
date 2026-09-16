import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadEvoluCurrentData, loadEvoluHistoryData } from "../evolu";
import { writeClipboardText } from "../platform/clipboard";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { EvoluCurrentDataPage } from "./EvoluCurrentDataPage";
import { EvoluDataDetailPage } from "./EvoluDataDetailPage";
import { EvoluHistoryTable } from "../components/EvoluHistoryTable";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({ t: (key: string) => key }),
}));
vi.mock("../app/context/SystemSettingsContexts", () => ({
  useEvoluSettingsContext: () => ({
    evoluTableCounts: {},
    evoluCashuOwnerIndex: null,
    evoluCashuOwnerEditsUntilRotation: null,
    evoluContactsOwnerIndex: null,
    evoluContactsOwnerEditsUntilRotation: null,
    evoluMessagesOwnerIndex: null,
    evoluMessagesOwnerEditsUntilRotation: null,
    evoluTransactionsOwnerIndex: null,
    evoluTransactionsOwnerEditsUntilRotation: null,
    evoluDatabaseBytes: 4096,
    evoluCashuOwnerId: "owner",
    evoluCashuVisibleOwnerIds: [],
    evoluContactsOwnerId: "owner",
    evoluMessagesOwnerId: "owner",
    evoluMessagesVisibleOwnerIds: [],
    evoluTransactionsOwnerId: "owner",
    evoluTransactionsVisibleOwnerIds: [],
  }),
}));
vi.mock("../evolu", () => ({
  loadEvoluCurrentData: vi.fn(),
  loadEvoluHistoryData: vi.fn(),
}));
vi.mock("../platform/clipboard", () => ({ writeClipboardText: vi.fn() }));

const secrets = [
  ["nostrIdentity", "nsec", "nsec1auditsecretkeymaterial"],
  ["cashuProof", "secret", "proof-spending-secret"],
  ["cashuProof", "c", "proof-signature-point"],
  ["cashuProof", "dleq", '{"r":"proof-blinding-secret"}'],
  ["cashuToken", "token", "cashuBspendable-token"],
  ["cashuToken", "rawToken", "cashuAlegacy-token"],
  ["cashuToken", "originalTokenText", "cashuAoriginal-token"],
  ["cashuOperation", "tokenText", "cashuBoperation-token"],
  ["cashuOperation", "error", "error containing a secret"],
  ["nostrMessage", "content", "cashuBmessage-token"],
  ["nostrMessage", "originalContent", "seed in original message"],
  ["nostrMessage", "replyToContent", "seed in quoted message"],
  ["transaction", "detailsJson", '{"token":"cashuBtransaction-token"}'],
  ["ownerMeta", "value", "owner metadata secret"],
  ["futureTable", "mnemonic", "future mnemonic secret"],
];

const history = secrets.map(([table, column, value], index) => ({
  table,
  column,
  value,
  id: `row-${index}`,
  timestamp: "2026-09-16",
  ownerId: "owner",
}));

const expectNoSecrets = (container: HTMLElement) => {
  for (const [, , secret] of secrets) {
    expect(container.outerHTML).not.toContain(secret.slice(0, 20));
  }
  expect(container.textContent).toContain("[redacted]");
};

const clickNamedButton = async (container: HTMLElement, name: string) => {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === name,
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
};

beforeEach(() => {
  vi.clearAllMocks();
  const data: Awaited<ReturnType<typeof loadEvoluCurrentData>> = {};
  for (const [table, column, value] of secrets) {
    const rows = (data[table] ??= []);
    rows.push({
      id: `row-${rows.length}`,
      ownerId: "owner",
      [column]: value,
      amount: 42,
    });
  }
  vi.mocked(loadEvoluCurrentData).mockResolvedValue(data);
  vi.mocked(loadEvoluHistoryData).mockResolvedValue(history);
  vi.mocked(writeClipboardText).mockResolvedValue(true);
});

describe("routine Evolu debug views", () => {
  it("redacts current values before preview, expansion, and copy", async () => {
    const view = await renderIntoDocument(<EvoluCurrentDataPage />);
    expectNoSecrets(view.container);
    for (const button of view.container.querySelectorAll("button")) {
      await act(async () => button.click());
    }
    expectNoSecrets(view.container);
    for (const button of view.container.querySelectorAll(
      ".evolu-data-button",
    )) {
      if (button instanceof HTMLButtonElement)
        await act(async () => button.click());
    }
    expect(writeClipboardText).toHaveBeenCalled();
    for (const [copied] of vi.mocked(writeClipboardText).mock.calls) {
      expect(secrets.some(([, , secret]) => copied.includes(secret))).toBe(
        false,
      );
    }
    expect(view.container.textContent).toContain("42");
    await view.unmount();
  });

  it("redacts both detail-page data sections", async () => {
    const view = await renderIntoDocument(<EvoluDataDetailPage />);
    await clickNamedButton(view.container, "evoluShowCurrentData");
    await clickNamedButton(view.container, "evoluShowHistoryData");
    expectNoSecrets(view.container);
    await view.unmount();
  });

  it("redacts history values including full tooltip attributes", async () => {
    const view = await renderIntoDocument(
      <EvoluHistoryTable rows={history} t={(key) => key} />,
    );
    expectNoSecrets(view.container);
    expect(
      view.container.querySelector('[title="proof-spending-secret"]'),
    ).toBeNull();
    await view.unmount();
  });
});
