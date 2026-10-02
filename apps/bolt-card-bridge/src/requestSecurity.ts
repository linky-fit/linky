import { isIP, isIPv4, SocketAddress } from "node:net";

export function normalizeIp(value: string): string {
  if (!isIP(value)) throw new Error("Expected an IP address");
  // Bun keeps the input's case, so a proxy listed as `2001:DB8::1` would
  // never match the lowercase address of the connection.
  return new SocketAddress({
    address: value,
    family: isIPv4(value) ? "ipv4" : "ipv6",
  }).address.toLowerCase();
}

/** Same rule as apps/push: only hops appended by trusted proxies count. */
export function clientIp(
  peer: string | undefined,
  forwarded: string | null,
  trustedProxyIps: readonly string[],
): string {
  if (!peer || !isIP(peer)) return "unknown";
  let current = normalizeIp(peer);
  if (!forwarded || !trustedProxyIps.includes(current)) return current;
  const hops = forwarded.split(",").map((hop) => hop.trim());
  // Walk from the socket peer toward the client; values left of the first
  // untrusted hop are supplied by that client and cannot identify it.
  for (const hop of hops.reverse()) {
    if (!trustedProxyIps.includes(current)) break;
    if (!isIP(hop)) return normalizeIp(peer);
    current = normalizeIp(hop);
  }
  return current;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<
    string,
    { resetAt: number; hits: number }
  >();

  /** False once `key` used up `maxHits` in the current window. */
  allow(
    key: string,
    maxHits: number,
    windowMs: number,
    nowMs: number,
  ): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= nowMs) {
      this.buckets.set(key, { hits: 1, resetAt: nowMs + windowMs });
      return true;
    }
    if (bucket.hits >= maxHits) return false;
    bucket.hits += 1;
    return true;
  }

  prune(nowMs: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= nowMs) this.buckets.delete(key);
    }
  }
}
