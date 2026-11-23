import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { Route } from "../../types/route";
import { AppRouteContent } from "./AppRouteContent";

const state = vi.hoisted(
  (): {
    closeScan: ReturnType<typeof vi.fn>;
    isDesktop: boolean;
    route: Route;
    scanIsOpen: boolean;
  } => ({
    closeScan: vi.fn(),
    isDesktop: true,
    route: { kind: "wallet" },
    scanIsOpen: true,
  }),
);

vi.mock("../hooks/shell", async () =>
  (await import("../../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../hooks/shell/scan", () => ({
  useScanCommands: () => ({ closeScan: state.closeScan }),
  useScanIsOpen: () => state.scanIsOpen,
}));
vi.mock("../../hooks/useRouting", () => ({
  useRouting: () => state.route,
}));
vi.mock("../../hooks/useDesktopSplitView", () => ({
  useDesktopSplitView: () => state.isDesktop,
}));
vi.mock("../../components/BottomTabBar", () => ({ BottomTabBar: () => null }));
vi.mock("../../components/DesktopNavigation", () => ({
  DesktopNavigation: () => null,
}));
vi.mock("../../components/PageBody", () => ({
  PageBody: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../../components/ScanModal", () => ({
  ScanModal: () => <div data-testid="scan-modal" />,
}));
vi.mock("../../components/Topbar", () => ({ Topbar: () => null }));
vi.mock("./MainTabPanes", () => ({
  ContactsPane: () => <div data-testid="contacts-pane" />,
  DesktopContactsPane: () => <div data-testid="desktop-contacts-pane" />,
  WalletPane: () => <div data-testid="wallet-pane" />,
}));
vi.mock("../../pages", () => ({
  AdvancedPage: () => <div data-testid="settings-page" />,
  CollaborationPage: () => <div data-testid="collaboration-page" />,
  DeveloperPage: () => <div data-testid="developer-page" />,
}));

afterEach(() => {
  state.closeScan.mockClear();
  state.isDesktop = true;
  state.route = { kind: "wallet" };
  state.scanIsOpen = true;
});

describe("AppRouteContent", () => {
  it("closes ScanModal automatically when the route changes on desktop split view", async () => {
    const view = await renderIntoDocument(<AppRouteContent />);

    expect(view.container.querySelector('[data-testid="scan-modal"]')).not.toBe(
      null,
    );
    expect(state.closeScan).not.toHaveBeenCalled();

    state.route = { kind: "settings" };
    await act(async () => {
      await view.rerender(<AppRouteContent />);
    });

    expect(state.closeScan).toHaveBeenCalledOnce();
  });

  it("renders DeveloperPage for the advanced route", async () => {
    state.isDesktop = false;
    state.scanIsOpen = false;
    state.route = { kind: "advanced" };
    const view = await renderIntoDocument(<AppRouteContent />);

    expect(
      view.container.querySelector('[data-testid="developer-page"]'),
    ).not.toBe(null);
  });
});
