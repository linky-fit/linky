import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "./testUtils/renderIntoDocument";

vi.hoisted(() => vi.stubEnv("VITE_EVOLU_SERVER_URLS", ""));
vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
vi.mock("./hooks/useDeferredOnlineReady", () => ({
  useDeferredOnlineReady: () => false,
}));

import { useEvoluServersManager } from "./evolu";

const linky = "wss://evolu.linky.fit";
const free = "wss://free.evoluhq.com";

beforeEach(() => localStorage.clear());

describe("Evolu server settings", () => {
  it.each([{ selected: [linky] }, { selected: [free] }, { selected: [] }])(
    "preserves the exact selection $selected when saving and reopening settings",
    async ({ selected }) => {
      function Settings() {
        const servers = useEvoluServersManager();
        return (
          <>
            <output>{JSON.stringify(servers.configuredUrls)}</output>
            <button onClick={() => servers.setServerUrls(selected)}>
              Save
            </button>
          </>
        );
      }
      const view = await renderIntoDocument(<Settings />);
      expect(view.container.querySelector("output")?.textContent).toBe(
        JSON.stringify([linky, free]),
      );
      await act(async () => view.container.querySelector("button")?.click());
      expect(view.container.querySelector("output")?.textContent).toBe(
        JSON.stringify(selected),
      );
      await view.unmount();
      const reopened = await renderIntoDocument(<Settings />);
      expect(reopened.container.querySelector("output")?.textContent).toBe(
        JSON.stringify(selected),
      );
      await reopened.unmount();
    },
  );
});
