import {
  emptyListingsDocument,
  ListingsDocument,
  Pubkey,
  type ListingsDraft,
} from "@linky-fit/linkstr";
import { Exit } from "effect";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyValuePort } from "../../platform/ports";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { usePublishWhenChanged } from "./usePublishWhenChanged";

const memoryKv = (): KeyValuePort => {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
  };
};

const alice = Pubkey.make(
  "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
);
const offering = new ListingsDocument({ cash: "offer" });

describe("usePublishWhenChanged", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("withdraws a document changed while its publish was in flight", async () => {
    const kv = memoryKv();
    const sent: ListingsDocument[] = [];
    const pending: Array<() => void> = [];
    const publish = (draft: ListingsDraft) => {
      sent.push(draft.document);
      return new Promise<Exit.Exit<unknown, unknown>>((resolve) => {
        pending.push(() => resolve(Exit.void));
      });
    };
    const Publisher = ({ document }: { document: ListingsDocument }) => {
      usePublishWhenChanged({
        kv,
        storageKey: "linky.listings.published.test",
        hydrated: true,
        document,
        recipients: [alice],
        publish,
      });
      return null;
    };

    const view = await renderIntoDocument(<Publisher document={offering} />);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(sent).toEqual([offering]);

    await view.rerender(<Publisher document={emptyListingsDocument} />);
    await act(async () => pending.shift()?.());
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(sent).toEqual([offering, emptyListingsDocument]);
  });
});
