import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnchainTransferView } from "../app/lib/onchainTransfers";
import {
  onchainTransferUpdateFixture,
  onchainTransferViewFixture,
} from "../testUtils/onchainTransfers";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { OnchainTransferHistoryRow } from "./OnchainTransfer";

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);

const renderRow = async (overrides: Partial<OnchainTransferView>) => {
  const { container } = await renderIntoDocument(
    <OnchainTransferHistoryRow
      transfer={onchainTransferViewFixture(overrides)}
    />,
  );
  return {
    text: container.textContent ?? "",
    phase: container.querySelector('[data-testid="onchain-transfer-phase"]')
      ?.textContent,
  };
};

describe("OnchainTransferHistoryRow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("titles a transfer by its direction and shows a completed one's amount without a phase", async () => {
    const row = await renderRow({ direction: "receive", phase: "completed" });
    expect(row.text).toContain("onchainReceiveHistoryTitle");
    expect(row.text).toContain("100000 sat");
    expect(row.phase).toBeUndefined();
  });

  it("puts the outcome beside the title, with the refunded amount", async () => {
    const transfer = onchainTransferViewFixture({ direction: "receive" });
    const row = await renderRow({
      ...transfer,
      phase: "refunded",
      update: onchainTransferUpdateFixture(transfer.id, {
        status: "refunded",
        receivedAmount: 50_000,
        refundAmount: 50_000,
      }),
    });
    expect(row.phase).toBe("onchainTransferPhaseRefunded");
    expect(row.text).toContain("50000 sat");
    expect(row.text).not.toContain("100000 sat");
  });

  it("says no money moved instead of an amount for an untouched cancellation", async () => {
    const row = await renderRow({ phase: "cancelled" });
    expect(row.text).toContain("onchainSendHistoryTitle");
    expect(row.phase).toBe("onchainTransferPhaseCancelled");
    expect(row.text).toContain("onchainTransferNoMoneyMoved");
    expect(row.text).not.toContain(" sat");
  });
});
