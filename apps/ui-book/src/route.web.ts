import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

function navigate(route: string) {
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): [string, (route: string) => void] {
  const route = useSyncExternalStore(
    subscribe,
    () => window.location.pathname + window.location.hash,
    () => "/",
  );
  return [route, navigate];
}
