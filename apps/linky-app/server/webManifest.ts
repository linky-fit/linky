import type { ManifestOptions } from "vite-plugin-pwa";

/** The PWA manifest, served as /manifest.webmanifest by every web build. */
export const webManifest: Partial<ManifestOptions> = {
  name: "Linky",
  short_name: "Linky",
  start_url: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#14b8a6",
  lang: "en",
  scope: "/",
  id: "/",
  orientation: "portrait-primary",
  protocol_handlers: [{ protocol: "web+cashu", url: "/#wallet?cashu=%s" }],
  related_applications: [
    { platform: "webapp", url: "/manifest.webmanifest", id: "/" },
  ],
  icons: [
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
    { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
  ],
};
