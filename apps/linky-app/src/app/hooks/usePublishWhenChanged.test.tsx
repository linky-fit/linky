import {
  emptyListingsDocument,
  ListingsDocument,
  Pubkey,
  RelayUrl,
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
const firstRelay = [RelayUrl.make("wss://first.example")];

const publisherOf = (
  publish: (draft: ListingsDraft) => Promise<Exit.Exit<unknown, unknown>>,
) => {
  const kv = memoryKv();
  return function Publisher({
    document,
    relays = firstRelay,
  }: {
    document: ListingsDocument;
    relays?: ReadonlyArray<RelayUrl>;
  }) {
    usePublishWhenChanged({
      kv,
      storageKey: "linky.listings.published.test",
      hydrated: true,
      document,
      recipients: [alice],
      relays,
      publish,
    });
    return null;
  };
};

const settle = () => act(() => vi.advanceTimersByTimeAsync(2_000));

describe("usePublishWhenChanged", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("withdraws a document changed while its publish was in flight", async () => {
    const sent: ListingsDocument[] = [];
    const pending: Array<() => void> = [];
    const Publisher = publisherOf((draft) => {
      sent.push(draft.document);
      return new Promise((resolve) => {
        pending.push(() => resolve(Exit.void));
      });
    });

    const view = await renderIntoDocument(<Publisher document={offering} />);
    await settle();
    expect(sent).toEqual([offering]);

    await view.rerender(<Publisher document={emptyListingsDocument} />);
    await act(async () => pending.shift()?.());
    await settle();
    expect(sent).toEqual([offering, emptyListingsDocument]);
  });

  it("publishes a state again after a failed publish that may have replaced some chunks", async () => {
    const sent: ListingsDocument[] = [];
    const outcomes = [Exit.void, Exit.fail("one chunk refused")];
    const Publisher = publisherOf((draft) => {
      sent.push(draft.document);
      return Promise.resolve(outcomes.shift() ?? Exit.void);
    });

    const view = await renderIntoDocument(<Publisher document={offering} />);
    await settle();
    await view.rerender(<Publisher document={emptyListingsDocument} />);
    await settle();
    await view.rerender(<Publisher document={offering} />);
    await settle();
    expect(sent).toEqual([offering, emptyListingsDocument, offering]);
  });

  it("publishes an unchanged document to an added relay", async () => {
    const sent: ListingsDocument[] = [];
    const Publisher = publisherOf((draft) => {
      sent.push(draft.document);
      return Promise.resolve(Exit.void);
    });

    const view = await renderIntoDocument(<Publisher document={offering} />);
    await settle();
    await view.rerender(
      <Publisher
        document={offering}
        relays={[...firstRelay, RelayUrl.make("wss://added.example")]}
      />,
    );
    await settle();
    expect(sent).toEqual([offering, offering]);
  });

  it("publishes an unchanged document again a week later, not on every start", async () => {
    vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
    const sent: ListingsDocument[] = [];
    const Publisher = publisherOf((draft) => {
      sent.push(draft.document);
      return Promise.resolve(Exit.void);
    });
    const start = async () => {
      const view = await renderIntoDocument(<Publisher document={offering} />);
      await settle();
      await view.unmount();
    };

    await start();
    await start();
    expect(sent).toEqual([offering]);

    vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
    await start();
    expect(sent).toEqual([offering, offering]);
  });
});
