const env = import.meta.env;

export const siteConfig = {
  webAppUrl: env.VITE_WEB_APP_URL || "https://app.fazole.fit",
  /** Where the contact form posts; the site's own function by default. */
  contactUrl: env.VITE_CONTACT_URL || "/api/contact",
  /** Where the demo's Bitcoin payments go: the Fazole support account in Linky. */
  supportNpub:
    "npub1wfxgaznkc7xz9t7zk6mwrn665twz6ghqdgmx0l3lumus2hhjs0yquvld92",
  /** Relays the support account reads, named in the Cashu request's Nostr transport. */
  supportRelays: [
    "wss://nostr.linky.fit",
    "wss://relay.damus.io",
    "wss://nos.lol",
  ],
  /** Serves the support account's Lightning address. */
  lightningAddressHost: "npub.linky.fit",
  linkyUrl: "https://linky.fit",
  githubUrl: "https://github.com/linky-fit/linky",
} as const;
