import { RegistryContext } from "@linky-fit/linkstr-react";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestAppRegistry } from "../testUtils/appRegistry";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { sessionAtom } from "./state/session/session";
import { toastsAtom } from "./state/shell/toasts";

const routeContentRenders = vi.hoisted(() => ({ count: 0 }));
const layoutRenders = vi.hoisted(() => ({ count: 0 }));
const watcherRenders = vi.hoisted(() => ({ count: 0 }));
const watcherTrigger = vi.hoisted((): { bump: (() => void) | null } => ({
  bump: null,
}));

vi.mock("./useAppShellComposition", () => ({
  AppShellWatchers: () => {
    watcherRenders.count += 1;
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
      watcherTrigger.bump = () => setTick((n) => n + 1);
    });
    return null;
  },
}));
vi.mock("./useUnauthenticatedAppShellComposition", () => ({
  useUnauthenticatedAppShellComposition: () => {
    throw new Error("should not mount unauthenticated shell");
  },
}));
vi.mock("./migrations/useLaneToShardMigration", () => ({
  useLaneToShardMigration: () => false,
}));
vi.mock("../devtools/inspector/usePersistentInspectorLogStartup", () => ({
  usePersistentInspectorLogStartup: () => {},
}));
vi.mock("./BeaconController", () => ({ BeaconController: () => null }));
vi.mock("./ListingsController", () => ({ ListingsController: () => null }));
vi.mock("./OnchainTransfersSync", () => ({ OnchainTransfersSync: () => null }));
vi.mock("../components/PwaUpdateBanner", () => ({
  PwaUpdateBanner: () => null,
}));
vi.mock("../components/InstallPwaBanner", () => ({
  InstallPwaBanner: () => null,
}));
vi.mock("../components/CashuContactSendBanner", () => ({
  CashuContactSendBanner: () => null,
}));
vi.mock("./hooks/wallet/useWalletTokens", () => ({
  useTokenContactSend: () => ({
    cancelPendingCashuContactSend: async () => {},
    pendingCashuContactSend: null,
  }),
}));
vi.mock("./hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../components/ToastNotifications", () => ({
  ToastNotifications: ({ toasts }: { toasts: readonly { id: string }[] }) => (
    <output data-testid="toast-count">{toasts.length}</output>
  ),
}));
vi.mock("../components/AuthenticatedLayout", () => ({
  AuthenticatedLayout: ({ children }: { children: React.ReactNode }) => {
    layoutRenders.count += 1;
    return <div data-testid="layout">{children}</div>;
  },
}));
vi.mock("./routes/AppRouteContent", () => ({
  AppRouteContent: () => {
    routeContentRenders.count += 1;
    return <div data-testid="route-content" />;
  },
}));

import AppShell from "./AppShell";

describe("AppShell render isolation", () => {
  afterEach(() => {
    routeContentRenders.count = 0;
    layoutRenders.count = 0;
    watcherRenders.count = 0;
    watcherTrigger.bump = null;
  });

  it("does not re-render AuthenticatedLayout or AppRouteContent on watcher or toast updates", async () => {
    const registry = makeTestAppRegistry();
    registry.set(sessionAtom, {
      _tag: "SignedIn",
      secrets: {
        nsec: "nsec1test",
        appMnemonic: null,
        cashuMnemonic: null,
        slip39Seed: null,
      },
      degraded: false,
    });

    const view = await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <AppShell />
      </RegistryContext.Provider>,
    );

    expect(watcherRenders.count).toBe(1);
    expect(watcherTrigger.bump).not.toBeNull();
    expect(layoutRenders.count).toBe(1);
    expect(routeContentRenders.count).toBe(1);

    await act(async () => {
      watcherTrigger.bump?.();
    });
    expect(watcherRenders.count).toBe(2);
    expect(layoutRenders.count).toBe(1);
    expect(routeContentRenders.count).toBe(1);

    await act(async () => {
      registry.set(toastsAtom, [{ id: "1", message: "Saved" }]);
    });
    expect(
      view.container.querySelector('[data-testid="toast-count"]')?.textContent,
    ).toBe("1");
    expect(layoutRenders.count).toBe(1);
    expect(routeContentRenders.count).toBe(1);

    await view.unmount();
  });
});
