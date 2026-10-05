import {
  NostrTransport,
  RelayPublishResult,
  RelayUrl,
} from "@linky-fit/linkstr";
import type { NostrTransportService } from "@linky-fit/linkstr";
import {
  Registry,
  RegistryContext,
  linkstrConfigAtom,
} from "@linky-fit/linkstr-react";
import {
  configWith,
  fakeTransport,
  makeIdentity,
} from "@linky-fit/linkstr-react/testing";
import type { PublishedEvent } from "@linky-fit/linkstr-react/testing";
import { Effect, Layer } from "effect";
import { finalizeEvent, nip19, verifyEvent } from "nostr-tools";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { clientInspectorStore } from "../../devtools/inspector/clientInspectorStore";
import {
  loadCachedRelayLists,
  saveCachedRelayLists,
} from "../../utils/nostrRelays";
import { saveRecommendedRelays } from "../../utils/recommendedRelays";
import type { Route } from "../../types/route";
import { useRelayDomain } from "./useRelayDomain";
import { useLinkstrInspectorBridge } from "../../devtools/inspector/useLinkstrInspectorBridge";
import InspectorPage from "../../pages/InspectorPage";

const identity = makeIdentity();
const nsec = nip19.nsecEncode(identity.secretKey);
const npub = nip19.npubEncode(identity.pubkey);
const custom = "wss://custom.example.com";
const inbox = "wss://inbox.example.com";
const retired = "wss://retired.example.com";
const recommended = [
  "wss://recommended-a.example.com",
  "wss://recommended-b.example.com",
];
const recommendedRelaysFetch = vi.fn(
  async () =>
    new Response(
      JSON.stringify({ nostr: recommended, evolu: ["wss://evolu.linky.fit"] }),
    ),
);
const now = Math.floor(Date.now() / 1000);
const published: PublishedEvent[] = [];
const views: Array<Awaited<ReturnType<typeof renderIntoDocument>>> = [];
const registries: Array<Registry.Registry> = [];
const setStatus = vi.fn();
let runtimeBuilds = 0;
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
  route: Route = { kind: "relays" },
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
      route,
      setStatus,
      t: (key) => key,
    });
    useEffect(() => {
      state = result;
    }, [result]);
    useEffect(() => {
      runtimeBuilds += 1;
      const relays = result.relayUrls.map((url) => RelayUrl.make(url));
      registry.set(
        linkstrConfigAtom,
        configWith(identity, layer, {
          readRelays: relays,
          writeRelays: relays,
          inspector: true,
        }),
      );
    }, [result.relayUrls]);
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
  vi.stubGlobal("fetch", recommendedRelaysFetch);
  recommendedRelaysFetch.mockClear();
  localStorage.clear();
  saveRecommendedRelays({ nostr: recommended, evolu: [], retiredNostr: [] });
  clientInspectorStore.clear();
  published.length = 0;
  state = undefined;
  setStatus.mockClear();
  runtimeBuilds = 0;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const view of views.splice(0)) await view.unmount();
  for (const registry of registries.splice(0)) registry.dispose();
});

const publishedTags = (kind: number) =>
  published
    .filter((event) => event.kind === kind)
    .at(-1)
    ?.tags.map((tag) => tag[1]);

describe("recommended Nostr relays", () => {
  it("publishes both signed lists with the recommended relays and keeps the user's", async () => {
    await mount(fakeTransport(published, [], storedLists([custom])));
    await flush();
    const expected = [...recommended, custom];
    expect(
      state?.relayUrls,
      JSON.stringify(clientInspectorStore.query().rows),
    ).toEqual(expected);
    expect(loadCachedRelayLists(identity.pubkey)?.relayUrls).toEqual(expected);
    for (const kind of [10002, 10050]) {
      const event = published.find((item) => item.kind === kind);
      expect(event).toBeDefined();
      if (!event) throw new Error("Missing published list");
      expect(verifyEvent(event)).toBe(true);
      expect(event.tags.map((tag) => tag[1])).toEqual(expected);
    }
    expect(setStatus).not.toHaveBeenCalled();
    const rows = clientInspectorStore.query().rows;
    expect(
      rows.find((row) => row.tag === "relayList.reconciled")?.links.wrap,
    ).toEqual(published.slice(0, 2).map((event) => event.id));
    const viewer = await renderIntoDocument(<InspectorPage />);
    views.push(viewer);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    const reconciledRow = Array.from(
      viewer.container.querySelectorAll('button[data-testid="timeline-row"]'),
    ).find((button) => button.textContent?.includes("relayList.reconciled"));
    expect(reconciledRow).toBeDefined();
    await act(async () => {
      reconciledRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      viewer.container.querySelector('[data-testid="related-rows"]')
        ?.textContent,
    ).toContain("WirePlainPublished");
  });

  it("does not republish lists that already carry the recommended relays", async () => {
    await mount(
      fakeTransport(
        published,
        [],
        storedLists([custom, ...recommended.map((url) => url + "/")]),
      ),
    );
    await flush();
    expect(state?.relayUrls).toEqual([...recommended, custom]);
    expect(published).toHaveLength(0);
    expect(recommendedRelaysFetch).toHaveBeenCalledWith(
      "https://linky.fit/recommended-relays",
    );
  });

  it("does not rebuild the Nostr runtime when a sync changes nothing", async () => {
    await mount(fakeTransport(published, [], storedLists(recommended)));
    await flush();
    expect(state?.relayUrls).toEqual(recommended);
    expect(runtimeBuilds).toBe(1);
    expect(published).toHaveLength(0);
  });

  it("uses a newer cache when the fetched list is stale", async () => {
    saveCachedRelayLists(identity.pubkey, {
      relayUrls: [inbox],
      relaysUpdatedAt: now - 10,
      dmRelaysUpdatedAt: now - 10,
    });
    await mount(fakeTransport(published, [], storedLists()));
    await flush();
    expect(state?.relayUrls).toEqual([...recommended, inbox]);
    expect(publishedTags(10002)).toEqual([...recommended, inbox]);
  });

  it("adds the recommended relays locally while offline and waits to publish", async () => {
    saveCachedRelayLists(identity.pubkey, {
      relayUrls: [custom],
      relaysUpdatedAt: 1,
      dmRelaysUpdatedAt: 1,
    });
    await mount(fakeTransport(published, []), false);
    expect(state?.relayUrls).toEqual([...recommended, custom]);
    expect(published).toHaveLength(0);
    expect(recommendedRelaysFetch).not.toHaveBeenCalled();
  });

  it("drops a relay the endpoint stopped recommending", async () => {
    saveRecommendedRelays({
      nostr: [...recommended, retired],
      evolu: [],
      retiredNostr: [],
    });
    await mount(
      fakeTransport(
        published,
        [],
        storedLists([...recommended, retired, custom]),
      ),
    );
    await flush();
    expect(state?.relayUrls).toEqual([...recommended, custom]);
    expect(publishedTags(10002)).toEqual([...recommended, custom]);
    expect(publishedTags(10050)).toEqual([...recommended, custom]);
  });

  it("keeps a retired relay the user adds back", async () => {
    saveRecommendedRelays({
      nostr: recommended,
      evolu: [],
      retiredNostr: [retired],
    });
    await mount(fakeTransport(published, []), false);
    await act(async () => state?.setNewRelayUrl(retired));
    await act(async () => state?.saveNewRelay());
    expect(state?.relayUrls).toEqual([...recommended, retired]);
  });

  it("retries a failed publish after 30 seconds without a reload", async () => {
    vi.useFakeTimers();
    try {
      let accepted = false;
      const transport = fakeTransport(published, [], storedLists());
      await mount({
        ...transport,
        publish: (relays, event) =>
          Effect.sync(() => {
            if (accepted) published.push(event);
            return relays.map(
              (relay) =>
                new RelayPublishResult({ relay, accepted, detail: null }),
            );
          }),
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(published).toHaveLength(0);
      accepted = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(publishedTags(10002)).toEqual([...recommended, custom]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes the user's relays but not the recommended ones", async () => {
    saveCachedRelayLists(identity.pubkey, {
      relayUrls: [custom],
      relaysUpdatedAt: 1,
      dmRelaysUpdatedAt: 1,
    });
    for (const id of [recommended[0] ?? "", custom]) {
      const view = await mount(fakeTransport(published, []), false, {
        kind: "nostrRelay",
        id,
      });
      expect(state?.isRecommendedRelay(id)).toBe(id !== custom);
      await act(async () => state?.requestDeleteSelectedRelay());
      await act(async () => state?.requestDeleteSelectedRelay());
      await view.unmount();
      views.splice(views.indexOf(view), 1);
    }
    expect(loadCachedRelayLists(identity.pubkey)?.relayUrls).toEqual(
      recommended,
    );
  });
});

it("rejects insecure and malformed relay entries before saving or publishing", async () => {
  await mount(fakeTransport(published, []), false);
  const initial = state?.relayUrls;
  for (const input of [
    "not-a-url",
    "ws://attacker.example",
    "https://relay.example",
  ]) {
    await act(async () => state?.setNewRelayUrl(input));
    expect(state?.canSaveNewRelay).toBe(false);
    await act(async () => state?.saveNewRelay());
    expect(state?.relayUrls).toEqual(initial);
  }
  expect(published).toEqual([]);
  expect(setStatus).toHaveBeenCalledWith("errorPrefix: invalidRelayUrl");
});
