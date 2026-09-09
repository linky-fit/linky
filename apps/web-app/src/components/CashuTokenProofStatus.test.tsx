import { TokenProofStateAmounts } from "@linky/linkshu";
import { Schema } from "effect";
import { act } from "react";
import { assert, describe, expect, it, vi } from "vitest";
import { createCashuTokenRowFixture } from "../testUtils/cashuTokenRow";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { CashuTokenProofStatus } from "./CashuTokenProofStatus";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    t: (key: string) => key,
    lang: "en",
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
  }),
}));

const row = createCashuTokenRowFixture({ amount: 100, state: "accepted" });
const report = (unspent: number, pending: number, spent = 0) =>
  Schema.decodeUnknownSync(TokenProofStateAmounts)({
    rowId: row.id,
    unspent,
    pending,
    spent,
    unknown: 0,
  });

describe("CashuTokenProofStatus", () => {
  it("shows mixed amounts and explicitly missing lock metadata", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokenProofStatus
        row={row}
        amount={100}
        busy={false}
        inspect={async () => [report(60, 40)]}
      />,
    );
    expect(container.textContent).toContain("cashuUnspentProofs60 sat");
    expect(container.textContent).toContain("cashuPendingAtMint40 sat");
    expect(container.textContent).toContain("cashuPendingReleaseUnknown");
    expect(container.textContent).toContain("cashuPendingOperationUnknown");
    expect(container.textContent).toContain("cashuPendingNotRecorded");
    expect(container.querySelector("time")?.dateTime).toBeTruthy();
    expect(container.textContent).not.toContain("2026-01-01");
    await unmount();
  });

  it("refreshes pending proofs to spent when the payment succeeds", async () => {
    const inspect = vi.fn(async () => [report(0, 100)]);
    const { container, unmount } = await renderIntoDocument(
      <CashuTokenProofStatus
        row={row}
        amount={100}
        busy={false}
        inspect={inspect}
      />,
    );
    inspect.mockResolvedValue([report(0, 0, 100)]);
    const refresh = container.querySelector("button");
    assert(refresh !== null);
    await act(async () => refresh.click());
    expect(container.textContent).toContain("cashuSpentProofs100 sat");
    expect(container.textContent).toContain("cashuUnspentProofs0 sat");
    expect(container.textContent).not.toContain("cashuPendingReleaseUnknown");
    await unmount();
  });

  it("does not infer a mint lock from a locally reserved row or a failed check", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokenProofStatus
        row={createCashuTokenRowFixture({ state: "reserved" })}
        amount={100}
        busy={false}
        inspect={async () => {
          throw new Error("Offline");
        }}
      />,
    );
    expect(container.textContent).toContain("cashuUnknownProofs100 sat");
    expect(container.textContent).not.toContain("cashuPendingReleaseUnknown");
    await unmount();
  });
});
