/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where "Otevřít aplikaci" leads; https://app.fazole.fit by default. */
  readonly VITE_WEB_APP_URL?: string;
  /** The site's own origin for canonical and Open Graph URLs (read in vite.config.ts). */
  readonly VITE_SITE_URL?: string;
}
