import { RegistryContext, useAtomSet } from "@linky-fit/linkstr-react";
import React from "react";
import { navigateTo, useRouting } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";
import { mainReturnTabAtom } from "../../state/shell/topbar";

/** Remembers the main tab the user was last on; mounted once by the shell. */
export const useMainReturnTabWatcher = (route: Route): void => {
  const setMainReturnTab = useAtomSet(mainReturnTabAtom);
  React.useEffect(() => {
    if (route.kind === "wallet" || route.kind === "contacts") {
      setMainReturnTab(route.kind);
    }
  }, [route.kind, setMainReturnTab]);
};

/** Back to the main tab the user came from, and Settings opened from it. */
export const useMainMenu = () => {
  const registry = React.useContext(RegistryContext);
  const route = useRouting();
  const navigateToMainReturn = React.useCallback(() => {
    navigateTo({ route: registry.get(mainReturnTabAtom) });
  }, [registry]);
  const openMenu = React.useCallback(() => {
    registry.set(
      mainReturnTabAtom,
      route.kind === "wallet" ? "wallet" : "contacts",
    );
    navigateTo({ route: "settings" });
  }, [registry, route.kind]);
  return { navigateToMainReturn, openMenu };
};
