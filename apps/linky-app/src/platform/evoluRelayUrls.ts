/** The `ws:` and `wss:` URLs of a comma-separated build setting. */
export const parseEvoluRelayUrls = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.startsWith("ws://") || url.startsWith("wss://"));
