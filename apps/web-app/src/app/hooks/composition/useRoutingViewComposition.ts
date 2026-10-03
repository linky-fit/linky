import type { MainTabRoutesProps } from "../../routes/AppRouteContent";
import { useMemoizedRouteBuilder } from "./useMemoizedRouteBundle";

type MainTabRouteBuilderInput = Omit<
  MainTabRoutesProps["mainTabProps"],
  "showGroupFilter" | "showNoGroupFilter"
>;

interface UseRoutingViewCompositionParams {
  groupNamesCount: number;
  mainTabRouteBuilderInput: MainTabRouteBuilderInput;
  statusFilterCount: number;
  ungroupedCount: number;
}

interface RoutingViewCompositionResult {
  mainTabRouteProps: MainTabRoutesProps;
}

export const useRoutingViewComposition = ({
  groupNamesCount,
  mainTabRouteBuilderInput,
  statusFilterCount,
  ungroupedCount,
}: UseRoutingViewCompositionParams): RoutingViewCompositionResult => {
  const routeKind = mainTabRouteBuilderInput.route.kind;
  const showGroupFilter =
    routeKind === "contacts" &&
    (groupNamesCount + statusFilterCount > 0 || ungroupedCount > 0);

  const routeBuilderInput = {
    ...mainTabRouteBuilderInput,
    showGroupFilter,
  };

  return {
    mainTabRouteProps: useMemoizedRouteBuilder(
      routeBuilderInput,
      (mainTabProps) => ({ mainTabProps }),
    ),
  };
};
