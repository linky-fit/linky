import { NostrTransport, RelayPublishResult, RelayUrl } from "@linky/linkstr";
import type { NostrTransportService } from "@linky/linkstr";
import {
  Registry,
  RegistryContext,
  linkstrConfigAtom,
} from "@linky/linkstr-react";
import {
  configWith,
  fakeTransport,
  makeIdentity,
} from "@linky/linkstr-react/testing";
import type { PublishedEvent } from "@linky/linkstr-react/testing";
import { Effect, Layer } from "effect";
import { finalizeEvent, nip19, verifyEvent } from "nostr-tools";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { clientInspectorStore } from "../../devtools/inspector/clientInspectorStore";
import {
  LINKY_NOSTR_RELAY,
  loadCachedRelayLists,
  needsLinkyNostrRelayMigration,
  saveCachedRelayLists,
} from "../../utils/nostrRelays";
import { useRelayDomain } from "./useRelayDomain";
import { useLinkstrInspectorBridge } from "../../devtools/inspector/useLinkstrInspectorBridge";
import InspectorPage from "../../pages/InspectorPage";

const identity = makeIdentity();
const nsec = nip19.nsecEncode(identity.secretKey);
const npub = nip19.npubEncode(identity.pubkey);
const custom = "wss://custom.example.com";
const inbox = "wss://inbox.example.com";
const now = Math.floor(Date.now() / 1000);
const published: PublishedEvent[] = [];
const views: Array<Awaited<ReturnType<typeof renderIntoDocument>>> = [];
const registries: Array<Registry.Registry> = [];
const setStatus = vi.fn();
let state: ReturnType<typeof useRelayDomain> | undefined;

const storedLists = (relays = [custom], dmRelays = relays) => [
  finalizeEvent(
    {
      kind: 10002,
      tags: relays.map((url) => ["r", url]),
      content: "",
      created_at: now - 60,
    },
    identity.secretKey,
  ),
  finalizeEvent(
    {
      kind: 10050,
      tags: dmRelays.map((url) => ["relay", url]),
      content: "",
      created_at: now - 60,
    },
    identity.secretKey,
  ),
];

const mount = async (
  transport: NostrTransportService,
  networkEnabled = true,
) => {
  const registry = Registry.make();
  registries.push(registry);
  const layer = Layer.succeed(NostrTransport, transport);
  registry.set(linkstrConfigAtom, configWith(identity, layer));
  const Harness = ({ enabled }: { enabled: boolean }) => {
    useLinkstrInspectorBridge();
    const result = useRelayDomain({
      currentNpub: npub,
      currentNsec: nsec,
      networkEnabled: enabled,
      route: { kind: "nostrRelays" },
      setStatus,
      t: (key) => key,
    });
    useEffect(() => {
      state = result;
    }, [result]);
    useEffect(() => {
      const relays = result.nostrFetchRelays.map((url) => RelayUrl.make(url));
      registry.set(
        linkstrConfigAtom,
        configWith(identity, layer, {
          readRelays: relays,
          writeRelays: relays,
          inspector: true,
        }),
      );
    }, [result.nostrFetchRelays]);
    return null;
  };
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Harness enabled={false} />
    </RegistryContext.Provider>,
  );
  views.push(view);
  await view.rerender(
    <RegistryContext.Provider value={registry}>
      <Harness enabled={networkEnabled} />
    </RegistryContext.Provider>,
  );
  return view;
};

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
};

beforeEach(() => {
  localStorage.clear();
  clientInspectorStore.clear();
  published.length = 0;
  state = undefined;
  setStatus.mockClear();
});
afterEach(async () => {
  for (const view of views.splice(0)) await view.unmount();
  for (const registry of registries.splice(0)) registry.dispose();
});

describe("Linky Nostr relay upgrade", () => {
  it("silently publishes both signed lists, preserves custom relays, and persists completion", async () => {
    saveCachedRelayLists(identity.pubkey, {
      relayUrls: [custom],
      relaysUpdatedAt: now - 100,
      dmRelaysUpdatedAt: now - 100,
    });
    await mount(fakeTransport(published, [], storedLists([custom], [inbox])));
    await flush();
    expect(
      state?.relayUrls,
      JSON.stringify(clientInspectorStore.query().rows),
    ).toEqual([custom, inbox, LINKY_NOSTR_RELAY]);
    expect(needsLinkyNostrRelayMigration(identity.pubkey)).toBe(false);
    expect(loadCachedRelayLists(identity.pubkey)?.relayUrls).toEqual(
      state?.relayUrls,
    );
    for (const kind of [10002, 10050]) {
      const event = published.find((item) => item.kind === kind);
      expect(event).toBeDefined();
      if (!event) throw new Error("Missing published list");
      expect(verifyEvent(event)).toBe(true);
      expect(event.tags.map((tag) => tag[1])).toEqual([
        custom,
        inbox,
        LINKY_NOSTR_RELAY,
      ]);
    }
    expect(setStatus).not.toHaveBeenCalled();
    const rows = clientInspectorStore.query().rows;
    expect(
      rows.find((row) => row.tag === "relayList.linkyRelayMigrated")?.links
        .wrap,
    ).toEqual(published.slice(0, 2).map((event) => event.id));
    const viewer = await renderIntoDocument(<InspectorPage />);
    views.push(viewer);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    const migrationRow = Array.from(
      viewer.container.querySelectorAll("button.timeline-row"),
    ).find((button) =>
      button.textContent?.includes("relayList.linkyRelayMigrated"),
    );
    expect(migrationRow).toBeDefined();
    await act(async () => {
      migrationRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      viewer.container.querySelector(".related-rows")?.textContent,
    ).toContain("WirePlainPublished");
  });

  it("uses a newer cache when the fetched list is stale", async () => {
    saveCachedRelayLists(identity.pubkey, {
      relayUrls: [inbox],
      relaysUpdatedAt: now - 10,
      dmRelaysUpdatedAt: now - 10,
    });
    await mount(fakeTransport(published, [], storedLists()));
    await flush();
    expect(state?.relayUrls).toEqual([inbox, LINKY_NOSTR_RELAY]);
    expect(needsLinkyNostrRelayMigration(identity.pubkey)).toBe(false);
  });

  it("adds Linky locally while offline and waits to publish", async () => {
    saveCachedRelayLists(identity.pubkey, {
      relayUrls: [custom],
      relaysUpdatedAt: 1,
      dmRelaysUpdatedAt: 1,
    });
    await mount(fakeTransport(published, []), false);
    expect(state?.relayUrls).toEqual([custom, LINKY_NOSTR_RELAY]);
    expect(published).toHaveLength(0);
    expect(needsLinkyNostrRelayMigration(identity.pubkey)).toBe(true);
  });

  it("keeps a partial publish pending and retries on the next launch", async () => {
    const transport = fakeTransport(published, [], storedLists());
    const view = await mount({
      ...transport,
      publish: (relays, event) =>
        Effect.succeed(
          relays.map(
            (relay) =>
              new RelayPublishResult({
                relay,
                accepted: event.kind === 10002,
                detail: "offline",
              }),
          ),
        ),
    });
    await flush();
    expect(needsLinkyNostrRelayMigration(identity.pubkey)).toBe(true);
    await view.unmount();
    views.splice(views.indexOf(view), 1);
    await mount(transport);
    await flush();
    expect(needsLinkyNostrRelayMigration(identity.pubkey)).toBe(false);
  });

  it("retries a failed migration after 30 seconds without a reload", async () => {
    vi.useFakeTimers();
    try {
      let accepted = false;
      const transport = fakeTransport(published, [], storedLists());
      await mount({
        ...transport,
        publish: (relays) =>
          Effect.succeed(
            relays.map(
              (relay) =>
                new RelayPublishResult({ relay, accepted, detail: null }),
            ),
          ),
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(needsLinkyNostrRelayMigration(identity.pubkey)).toBe(true);
      accepted = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(needsLinkyNostrRelayMigration(identity.pubkey)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not repeat the migration after later user removal", async () => {
    const view = await mount(fakeTransport(published, [], storedLists()));
    await flush();
    await view.unmount();
    views.splice(views.indexOf(view), 1);
    saveCachedRelayLists(identity.pubkey, {
      relayUrls: [custom],
      relaysUpdatedAt: now + 1,
      dmRelaysUpdatedAt: now + 1,
    });
    published.length = 0;
    await mount(fakeTransport(published, [], storedLists()));
    await flush();
    expect(state?.relayUrls).toEqual([custom]);
    expect(published).toHaveLength(0);
  });

  it("does not duplicate a Linky relay with a trailing slash", async () => {
    await mount(
      fakeTransport(
        published,
        [],
        storedLists([custom, LINKY_NOSTR_RELAY + "/"]),
      ),
    );
    await flush();
    expect(state?.relayUrls).toEqual([custom, LINKY_NOSTR_RELAY + "/"]);
    expect(needsLinkyNostrRelayMigration(identity.pubkey)).toBe(false);
  });
});
