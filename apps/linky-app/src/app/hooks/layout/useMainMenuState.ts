import { RegistryContext, useAtomSet } from "@linky-fit/linkstr-react";
import React from "react";
import { navigateTo } from "../../../hooks/useRouting";
import type { Route } from "../../../types/route";
import { mainReturnTabAtom } from "../../state/shell/topbar";
import { useSetNavIntent } from "../shell/navIntents";

const CASHU_TOKEN_ROUTE_KINDS: ReadonlySet<Route["kind"]> = new Set([
  "cashuTokens",
  "cashuToken",
  "cashuTokenNew",
  "cashuTokenEmit",
  "cashuProofs",
]);

/** Remembers the main tab and clears scoped back intents on route change; mounted once by the shell. */
export const useMainReturnTabWatcher = (route: Route): void => {
  const setMainReturnTab = useAtomSet(mainReturnTabAtom);
  const setCashuTokensBackTo = useSetNavIntent("cashuTokensBackTo");
  const setEvoluDataBackTo = useSetNavIntent("evoluDataBackTo");
  React.useEffect(() => {
    if (route.kind === "wallet" || route.kind === "contacts") {
      setMainReturnTab(route.kind);
    }
    if (!CASHU_TOKEN_ROUTE_KINDS.has(route.kind)) {
      setCashuTokensBackTo(null);
    }
    if (route.kind !== "evoluCurrentData") {
      setEvoluDataBackTo(null);
    }
  }, [route.kind, setCashuTokensBackTo, setEvoluDataBackTo, setMainReturnTab]);
};

/** Back to the main tab the user came from. */
export const useMainMenu = () => {
  const registry = React.useContext(RegistryContext);
  const navigateToMainReturn = React.useCallback(() => {
    navigateTo({ route: registry.get(mainReturnTabAtom) });
  }, [registry]);
  return { navigateToMainReturn };
};
