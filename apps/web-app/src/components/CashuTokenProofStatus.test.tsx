import { ProofStateSnapshot } from "@linky/linkshu";
import { Schema } from "effect";
import { act } from "react";
import { assert, describe, expect, it, vi } from "vitest";
import { createStoredProofFixture } from "../testUtils/cashuInventory";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { CashuTokenProofStatus } from "./CashuTokenProofStatus";

vi.mock("../app/context/AppShellContexts", () => ({
  useAppShellCore: () => ({
    t: (key: string) => key,
    lang: "en",
    formatDisplayedAmountText: (amount: number) => `${amount} sat`,
  }),
}));

const first = createStoredProofFixture({
  id: "AAAAAAAAAAAAAAAAAAAAAA",
  amount: 60,
  state: "handedOut",
});
const second = createStoredProofFixture({
  id: "AgICAgICAgICAgICAgICAg",
  amount: 40,
  state: "handedOut",
});
const snapshot = (proofId: string, state: ProofStateSnapshot["state"]) =>
  Schema.decodeUnknownSync(ProofStateSnapshot)({ proofId, state });

describe("CashuTokenProofStatus", () => {
  it("sums the transfer's proofs by the mint's answer", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokenProofStatus
        proofs={[first, second]}
        busy={false}
        inspect={async () => [
          snapshot(first.id, "unspent"),
          snapshot(second.id, "pending"),
        ]}
      />,
    );
    expect(container.textContent).toContain("cashuUnspentProofs60 sat");
    expect(container.textContent).toContain("cashuPendingAtMint40 sat");
    expect(container.textContent).toContain("cashuPendingQuoteExpiryHint");
    expect(container.querySelector("time")?.dateTime).toBeTruthy();
    await unmount();
  });

  it("refreshes pending proofs to spent once the recipient claimed them", async () => {
    const inspect = vi.fn(async () => [
      snapshot(first.id, "pending"),
      snapshot(second.id, "pending"),
    ]);
    const { container, unmount } = await renderIntoDocument(
      <CashuTokenProofStatus
        proofs={[first, second]}
        busy={false}
        inspect={inspect}
      />,
    );
    inspect.mockResolvedValue([
      snapshot(first.id, "spent"),
      snapshot(second.id, "spent"),
    ]);
    const refresh = container.querySelector("button");
    assert(refresh !== null);
    await act(async () => refresh.click());
    expect(container.textContent).toContain("cashuSpentProofs100 sat");
    expect(container.textContent).toContain("cashuUnspentProofs0 sat");
    expect(container.textContent).not.toContain("cashuPendingQuoteExpiryHint");
    await unmount();
  });

  it("reports a failed check as unknown, never as pending", async () => {
    const { container, unmount } = await renderIntoDocument(
      <CashuTokenProofStatus
        proofs={[first, second]}
        busy={false}
        inspect={async () => {
          throw new Error("Offline");
        }}
      />,
    );
    expect(container.textContent).toContain("cashuUnknownProofs100 sat");
    expect(container.textContent).not.toContain("cashuPendingQuoteExpiryHint");
    await unmount();
  });
});
