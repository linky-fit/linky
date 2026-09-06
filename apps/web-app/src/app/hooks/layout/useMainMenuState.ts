import React from "react";
import { navigateTo } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";

interface UseMainMenuStateParams {
  onClose?: () => void;
  onOpen?: () => void;
  route: Route;
}

export const useMainMenuState = ({
  onClose,
  onOpen,
  route,
}: UseMainMenuStateParams) => {
  const [menuIsOpen, setMenuIsOpen] = React.useState(false);

  const mainReturnRouteRef = React.useRef<Route>({ kind: "contacts" });
  const menuOpenRouteRef = React.useRef<Route["kind"] | null>(null);

  const setMainReturnFromRoute = React.useCallback((nextRoute: Route) => {
    // Menu modal is intended as an overlay for the main screens.
    if (nextRoute.kind === "wallet") {
      mainReturnRouteRef.current = { kind: "wallet" };
    } else {
      mainReturnRouteRef.current = { kind: "contacts" };
    }
  }, []);

  React.useEffect(() => {
    if (route.kind === "wallet") {
      mainReturnRouteRef.current = { kind: "wallet" };
      return;
    }
    if (route.kind === "contacts") {
      mainReturnRouteRef.current = { kind: "contacts" };
    }
  }, [route.kind]);

  const navigateToMainReturn = React.useCallback(() => {
    const target = mainReturnRouteRef.current ?? { kind: "contacts" };
    if (target.kind === "wallet") {
      navigateTo({ route: "wallet" });
      return;
    }
    navigateTo({ route: "contacts" });
  }, []);

  const openMenu = React.useCallback(() => {
    setMainReturnFromRoute(route);
    setMenuIsOpen(false);
    onOpen?.();
    menuOpenRouteRef.current = route.kind;
    navigateTo({ route: "settings" });
  }, [onOpen, route, setMainReturnFromRoute]);

  const closeMenu = React.useCallback(() => {
    setMenuIsOpen(false);
    onClose?.();
  }, [onClose]);

  const toggleMenu = React.useCallback(() => {
    if (menuIsOpen) {
      closeMenu();
      return;
    }
    openMenu();
  }, [closeMenu, menuIsOpen, openMenu]);

  // Close the menu only if navigation happens while it is open.
  React.useEffect(() => {
    if (!menuIsOpen) return;
    const openedAt = menuOpenRouteRef.current;
    if (openedAt && openedAt !== route.kind) {
      setMenuIsOpen(false);
    }
  }, [menuIsOpen, route.kind]);

  return {
    closeMenu,
    menuIsOpen,
    navigateToMainReturn,
    toggleMenu,
  };
};
