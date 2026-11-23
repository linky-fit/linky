import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { Route } from "../../../types/route";
import { navIntentsAtom } from "../../state/shell/navIntents";
import { useMainReturnTabWatcher } from "./useMainMenuState";

const Watcher = ({ route }: { route: Route }): null => {
  useMainReturnTabWatcher(route);
  return null;
};

describe("useMainReturnTabWatcher", () => {
  it("keeps cashuTokensBackTo inside the token routes and clears it when leaving", async () => {
    const registry = AtomRegistry.make();
    const { rerender, unmount } = await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <Watcher route={{ kind: "advanced" }} />
      </RegistryContext.Provider>,
    );

    await act(async () => {
      registry.set(navIntentsAtom, {
        ...registry.get(navIntentsAtom),
        cashuTokensBackTo: "advanced",
      });
    });

    await rerender(
      <RegistryContext.Provider value={registry}>
        <Watcher route={{ kind: "cashuTokens" }} />
      </RegistryContext.Provider>,
    );
    expect(registry.get(navIntentsAtom).cashuTokensBackTo).toBe("advanced");

    await rerender(
      <RegistryContext.Provider value={registry}>
        <Watcher route={{ kind: "cashuTokenEmit" }} />
      </RegistryContext.Provider>,
    );
    expect(registry.get(navIntentsAtom).cashuTokensBackTo).toBe("advanced");

    await rerender(
      <RegistryContext.Provider value={registry}>
        <Watcher route={{ kind: "wallet" }} />
      </RegistryContext.Provider>,
    );
    expect(registry.get(navIntentsAtom).cashuTokensBackTo).toBeNull();

    await unmount();
  });

  it("keeps evoluDataBackTo on evoluCurrentData and clears it when leaving", async () => {
    const registry = AtomRegistry.make();
    const { rerender, unmount } = await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <Watcher route={{ kind: "advanced" }} />
      </RegistryContext.Provider>,
    );

    await act(async () => {
      registry.set(navIntentsAtom, {
        ...registry.get(navIntentsAtom),
        evoluDataBackTo: "advanced",
      });
    });

    await rerender(
      <RegistryContext.Provider value={registry}>
        <Watcher route={{ kind: "evoluCurrentData" }} />
      </RegistryContext.Provider>,
    );
    expect(registry.get(navIntentsAtom).evoluDataBackTo).toBe("advanced");

    await rerender(
      <RegistryContext.Provider value={registry}>
        <Watcher route={{ kind: "wallet" }} />
      </RegistryContext.Provider>,
    );
    expect(registry.get(navIntentsAtom).evoluDataBackTo).toBeNull();

    await unmount();
  });
});
