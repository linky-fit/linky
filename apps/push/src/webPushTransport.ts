import { promises as dns, type LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import type { RequestDetails } from "web-push";
// Bun shadows the bare undici import with a shim; pinned TLS needs the npm implementation.
import { Agent, request } from "undici/index.js";

import { isPublicAddress, parsePushEndpoint } from "./endpoint";

export const MAX_PUSH_RESPONSE_BYTES = 16 * 1024;
const DELIVERY_TIMEOUT_MS = 12_000;

export class PushResponseError extends Error {
  readonly statusCode: number;
  readonly body: string;

  constructor(statusCode: number, body: string) {
    super(`Push provider returned HTTP ${statusCode}`);
    this.statusCode = statusCode;
    this.body = body;
  }
}

const pinnedLookup =
  (addresses: LookupAddress[]): LookupFunction =>
  (_hostname, options, callback) => {
    const first = addresses[0];
    if (!first) {
      callback(new Error("No push provider addresses"), "", 0);
    } else if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, first.address, first.family);
    }
  };

export async function postPushRequest(
  url: URL,
  addresses: LookupAddress[],
  details: RequestDetails,
  signal: AbortSignal,
  createAgent: (lookup: LookupFunction) => Agent = (lookup) =>
    new Agent({ connect: { lookup }, maxHeaderSize: 16 * 1024 }),
): Promise<void> {
  const agent = createAgent(pinnedLookup(addresses));
  try {
    const response = await request(url, {
      method: "POST",
      headers: details.headers,
      body: details.body,
      dispatcher: agent,
      signal,
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        if (!(chunk instanceof Uint8Array))
          throw new Error("Unexpected push provider response chunk");
        bytes += chunk.byteLength;
        if (bytes > MAX_PUSH_RESPONSE_BYTES) {
          throw new Error("Push provider response exceeds size limit");
        }
        chunks.push(chunk);
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new PushResponseError(
        response.statusCode,
        Buffer.concat(chunks).toString("utf8"),
      );
    }
  } finally {
    await agent.destroy();
  }
}

interface PushTransport {
  lookup: (hostname: string) => Promise<LookupAddress[]>;
  post: typeof postPushRequest;
}

const transport: PushTransport = {
  lookup: (hostname) => dns.lookup(hostname, { all: true }),
  post: postPushRequest,
};

export async function sendWebPushRequest(
  details: RequestDetails,
  network: PushTransport = transport,
): Promise<void> {
  const url = parsePushEndpoint(details.endpoint);
  const signal = AbortSignal.timeout(DELIVERY_TIMEOUT_MS);
  const addresses = await Promise.race([
    network.lookup(url.hostname),
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    }),
  ]);
  if (
    !addresses.length ||
    !addresses.every(({ address }) => isPublicAddress(address))
  ) {
    throw new Error("Push endpoint resolves to a non-public address");
  }
  // Each delivery gets a new socket pinned to these checked addresses. HTTPS
  // keeps the original hostname for certificate checks and never follows redirects.
  await network.post(url, addresses, details, signal);
}
