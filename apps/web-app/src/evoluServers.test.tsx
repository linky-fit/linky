import { RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestAppRegistry } from "./testUtils/appRegistry";
import { renderIntoDocument } from "./testUtils/renderIntoDocument";

vi.mock("./hooks/useDeferredOnlineReady", () => ({
  useDeferredOnlineReady: () => false,
}));

import { useEvoluServersManager } from "./evolu";

const recommended = [
  "wss://evolu.eu.freedomrelay.dev",
  "wss://evolu.linky.fit",
];
const custom = "wss://sync.example.com";

beforeEach(() => localStorage.clear());

describe("Evolu relay settings", () => {
  it.each([{ saved: [custom], configured: [...recommended, custom] }])(
    "keeps the recommended relays when saving $saved and reopening settings",
    async ({ saved, configured }) => {
      const registry = makeTestAppRegistry({ evoluPlatform: null });
      function Settings() {
        const servers = useEvoluServersManager();
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
});
