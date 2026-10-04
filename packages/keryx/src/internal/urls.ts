const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "[::1]" ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

/**
 * Keryx fetches only HTTPS URLs; plain HTTP is accepted for loopback hosts so
 * a publisher can be developed locally. No credentials, no fragment.
 */
export const parseKeryxUrl = (text: string): URL | null => {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const secure =
    url.protocol === "https:" ||
    (url.protocol === "http:" && isLoopbackHost(url.hostname));
  return secure && url.username === "" && url.password === "" && url.hash === ""
    ? url
    : null;
};

/** The URL itself, or its one canonical redirect (http→https, www→apex). */
export const allowedRedirectTargets = (requested: URL): ReadonlySet<string> => {
  const canonical = new URL(requested);
  canonical.protocol = "https:";
  canonical.hostname = canonical.hostname.replace(/^www\./, "");
  return new Set([requested.href, canonical.href]);
};
