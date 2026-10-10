const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

/**
 * The origin a login is bound to, or `null` when `value` is not an
 * acceptable site: https, or http on localhost, 127.0.0.1 or [::1] for
 * development. Paths are dropped; credentials are rejected.
 */
export const normalizeAudience = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  const acceptable =
    url.protocol === "https:" ||
    (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  return acceptable ? url.origin : null;
};
