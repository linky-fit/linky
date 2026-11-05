import React from "react";
import { expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { ContactRowLike } from "../../types/appTypes";
import {
  type ContactSummary,
  isPayableContact,
  useContactSummaries,
} from "./useContactSummaries";

const rows = vi.hoisted((): ContactRowLike[] => []);
vi.mock("../useLinksync", () => ({ useContactRows: () => rows }));

it("keeps deleted contacts for naming but not for paying", async () => {
  rows.push(
    { id: "alice", name: "Alice", npub: "npub1alice" },
    { id: "bob", name: "Bob", npub: "npub1bob", archivedAtSec: 100 },
  );
  const seen: { current: Map<string, ContactSummary> | null } = {
    current: null,
  };
  const Probe = (): null => {
    const summaries = useContactSummaries();
    React.useEffect(() => {
      seen.current = summaries;
    }, [summaries]);
    return null;
  };
  const { unmount } = await renderIntoDocument(<Probe />);
  const summaries = [...(seen.current?.values() ?? [])];
  expect(summaries.map((summary) => summary.name)).toEqual(["Alice", "Bob"]);
  expect(
    summaries.filter(isPayableContact).map((summary) => summary.id),
  ).toEqual(["alice"]);
  await unmount();
});
