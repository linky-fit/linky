import { RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEvoluServerProbes, useEvoluServers } from "./evolu";
import { makeTestAppRegistry } from "./testUtils/appRegistry";
import { renderIntoDocument } from "./testUtils/renderIntoDocument";

const recommended = [
  "wss://evolu.eu.freedomrelay.dev",
  "wss://evolu.linky.fit",
];
const custom = "wss://sync.example.com";

beforeEach(() => localStorage.clear());

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Evolu relay settings", () => {
  it.each([{ saved: [custom], configured: [...recommended, custom] }])(
    "keeps the recommended relays when saving $saved and reopening settings",
    async ({ saved, configured }) => {
      const registry = makeTestAppRegistry({ evoluPlatform: null });
      function Settings() {
        const servers = useEvoluServers();
        return (
          <>
            <output>{JSON.stringify(servers.configuredUrls)}</output>
            <data>
              {JSON.stringify(
                servers.configuredUrls.map(servers.isRecommended),
              )}
            </data>
            <button onClick={() => servers.setServerUrls(saved)}>Save</button>
          </>
        );
      }
      const page = (
        <RegistryContext.Provider value={registry}>
          <Settings />
        </RegistryContext.Provider>
      );
      const view = await renderIntoDocument(page);
      expect(view.container.querySelector("output")?.textContent).toBe(
        JSON.stringify(recommended),
      );
      await act(async () => view.container.querySelector("button")?.click());
      expect(view.container.querySelector("output")?.textContent).toBe(
        JSON.stringify(configured),
      );
      await view.unmount();
      const reopened = await renderIntoDocument(page);
      expect(reopened.container.querySelector("output")?.textContent).toBe(
        JSON.stringify(configured),
      );
      expect(reopened.container.querySelector("data")?.textContent).toBe(
        JSON.stringify(configured.map((url) => recommended.includes(url))),
      );
      await reopened.unmount();
    },
  );

  it("shows recorded relay statuses on the first render of a settings page", async () => {
    vi.useFakeTimers();
    class OpeningWebSocket extends EventTarget {
      constructor() {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }
      close() {}
    }
    vi.stubGlobal("WebSocket", OpeningWebSocket);
    const registry = makeTestAppRegistry({ evoluPlatform: null });
    function Shell() {
      useEvoluServerProbes();
      return null;
    }
    const shell = await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <Shell />
      </RegistryContext.Provider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    let firstRender: string | null = null;
    function Settings() {
      const { statusByUrl } = useEvoluServers();
      firstRender ??= JSON.stringify(statusByUrl);
      return null;
    }
    const page = await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <Settings />
      </RegistryContext.Provider>,
    );
    expect(firstRender).toBe(
      JSON.stringify(
        Object.fromEntries(recommended.map((url) => [url, "connected"])),
      ),
    );
    await page.unmount();
    await shell.unmount();
  });
});
