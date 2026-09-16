import { isIP, isIPv4, SocketAddress } from "node:net";

import { RequestError } from "./guards";

export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export function normalizeIp(value: string): string {
  if (!isIP(value)) throw new Error("Expected an IP address");
  return new SocketAddress({
    address: value,
    family: isIPv4(value) ? "ipv4" : "ipv6",
  }).address;
}

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

export async function readBoundedBody(request: Request): Promise<string> {
  const tooLarge = () =>
    new RequestError(413, "body_too_large", "Request body exceeds 64 KiB");
  const length = request.headers.get("content-length");
  if (length && Number(length) > MAX_REQUEST_BODY_BYTES) {
    await request.body?.cancel();
    throw tooLarge();
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
