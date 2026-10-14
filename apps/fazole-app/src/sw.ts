/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

const isSkipWaiting = (data: unknown) =>
  typeof data === "object" &&
  data !== null &&
  "type" in data &&
  data.type === "SKIP_WAITING";

// The update banner's workbox-window posts this when the merchant accepts a new release.
self.addEventListener("message", (event) => {
  if (isSkipWaiting(event.data)) void self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
