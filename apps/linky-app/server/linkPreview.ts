import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface LinkPreviewResult {
  description: string | null;
  faviconUrl: string | null;
  imageUrl: string | null;
  siteName: string;
  title: string;
  url: string;
}

const MAX_HTML_BYTES = 512_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8_000;

const isPrivateIpv4 = (address: string): boolean => {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
};

const isPrivateIpAddress = (address: string): boolean => {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) !== 6) return true;

  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
};

const assertSafeTarget = async (url: URL): Promise<void> => {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported protocol");
  }
  if (url.username || url.password)
    throw new Error("Credentials are not allowed");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("Non-standard ports are not allowed");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Local hosts are not allowed");
  }

  if (isIP(hostname)) {
    if (isPrivateIpAddress(hostname))
      throw new Error("Private IP is not allowed");
    return;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateIpAddress(address))
  ) {
    throw new Error("Private host is not allowed");
  }
};

const fetchHtml = async (
  initialUrl: URL,
): Promise<{ html: string; url: URL }> => {
  let target = initialUrl;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    await assertSafeTarget(target);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(target, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "LinkyLinkPreview/1.0 (+https://linky.fit)",
        },
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }

    if (response.status >= 300 && response.status < 400) {
      clearTimeout(timeout);
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error("Too many redirects");
      }
      target = new URL(location, target);
      continue;
    }
    if (!response.ok) {
      clearTimeout(timeout);
      throw new Error(`Target returned ${response.status}`);
    }
    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
      clearTimeout(timeout);
      throw new Error("Target is not HTML");
    }

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_HTML_BYTES) {
      clearTimeout(timeout);
      throw new Error("Page is too large");
    }

    try {
      const reader = response.body?.getReader();
      if (!reader) return { html: await response.text(), url: target };
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_HTML_BYTES) {
          await reader.cancel();
          throw new Error("Page is too large");
        }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { html: new TextDecoder().decode(bytes), url: target };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Could not load page");
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();

const getAttributes = (tag: string): Map<string, string> => {
  const attributes = new Map<string, string>();
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const name = String(match[1] ?? "").toLowerCase();
    const value = String(match[2] ?? match[3] ?? match[4] ?? "");
    if (name) attributes.set(name, decodeHtml(value));
  }
  return attributes;
};

const getMeta = (html: string, names: readonly string[]): string | null => {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = getAttributes(tag);
    const key = (
      attributes.get("property") ??
      attributes.get("name") ??
      ""
    ).toLowerCase();
    const content = attributes.get("content")?.trim() ?? "";
    if (wanted.has(key) && content) return content;
  }
  return null;
};

const getTitle = (html: string): string | null => {
  const raw = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return raw ? decodeHtml(raw.replace(/<[^>]+>/g, "")) : null;
};

const getFavicon = (html: string): string | null => {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attributes = getAttributes(tag);
    const rel = attributes.get("rel")?.toLowerCase() ?? "";
    const href = attributes.get("href")?.trim() ?? "";
    if (rel.split(/\s+/).includes("icon") && href) return href;
  }
  return null;
};

const resolvePublicUrl = (value: string | null, base: URL): string | null => {
  if (!value) return null;
  try {
    const resolved = new URL(value, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
};

const limit = (value: string | null, maxLength: number): string | null => {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  return normalized ? normalized.slice(0, maxLength) : null;
};

export const fetchLinkPreview = async (
  rawUrl: string,
): Promise<LinkPreviewResult> => {
  if (!rawUrl || rawUrl.length > 2_000) throw new Error("Invalid URL");
  const initialUrl = new URL(rawUrl);
  const { html, url } = await fetchHtml(initialUrl);
  const title = limit(
    getMeta(html, ["og:title", "twitter:title"]) ?? getTitle(html),
    200,
  );
  if (!title) throw new Error("Page has no title");

  return {
    description: limit(
      getMeta(html, ["og:description", "twitter:description", "description"]),
      320,
    ),
    faviconUrl: resolvePublicUrl(getFavicon(html) ?? "/favicon.ico", url),
    imageUrl: resolvePublicUrl(
      getMeta(html, ["og:image", "twitter:image", "twitter:image:src"]),
      url,
    ),
    siteName:
      limit(getMeta(html, ["og:site_name"]), 80) ??
      url.hostname.replace(/^www\./, ""),
    title,
    url: url.toString(),
  };
};
