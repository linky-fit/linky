import { useGlobalSearchParams, usePathname } from "expo-router";
import { routePathForRouter, type SpdStore } from "./routeUrl";

/** The route path expo-router is showing. */
export const useRouterRoutePath = (store: SpdStore): string => {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const search = new URLSearchParams(
    Object.entries(params)
      // `segments` is the catch-all route's param, not a query param.
      .filter(([key]) => key !== "segments")
      .flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value]).map((item) => [key, item]),
      ),
  );
  return routePathForRouter(pathname, search, store);
};
