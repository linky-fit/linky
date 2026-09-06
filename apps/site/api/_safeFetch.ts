import { promises as dns, type LookupAddress } from "node:dns";
import {
  BlockList,
  isIPv4,
  SocketAddress,
  type IPVersion,
  type LookupFunction,
} from "node:net";
import { Agent, fetch } from "undici";

const MAX_REDIRECTS = 3;
const HOP_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 64 * 1024;

type Subnet = readonly [network: string, prefix: number];

const IPV4_RESERVED: readonly Subnet[] = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. cloud metadata endpoints
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, incl. broadcast
];

// IANA hands out IPv6 global unicast only from 2000::/3; everything outside it
// (unspecified, loopback, IPv4-mapped, ULA fc00::/7, link-local fe80::/10,
// multicast ff00::/8, ...) is non-public by definition.
const IPV6_GLOBAL_UNICAST: readonly Subnet[] = [["2000::", 3]];

const IPV6_RESERVED: readonly Subnet[] = [
  ["2001:2::", 48], // benchmarking
  ["2001:10::", 28], // ORCHID
  ["2001:20::", 28], // ORCHIDv2
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, embeds an arbitrary IPv4 address
];

const blockListOf = (
  subnets: readonly Subnet[],
  type: IPVersion,
): BlockList => {
  const list = new BlockList();
  for (const [network, prefix] of subnets)
    list.addSubnet(network, prefix, type);
  return list;
};

const ipv4Reserved = blockListOf(IPV4_RESERVED, "ipv4");
const ipv6GlobalUnicast = blockListOf(IPV6_GLOBAL_UNICAST, "ipv6");
const ipv6Reserved = blockListOf(IPV6_RESERVED, "ipv6");

const parseAddress = (ip: string): SocketAddress | null => {
  try {
    return new SocketAddress({
      address: ip,
      family: isIPv4(ip) ? "ipv4" : "ipv6",
    });
  } catch {
    return null;
  }
};

export const isPublicAddress = (ip: string): boolean => {
  const address = parseAddress(ip);
  if (!address) return false;
  if (address.family === "ipv4") return !ipv4Reserved.check(address);
  return ipv6GlobalUnicast.check(address) && !ipv6Reserved.check(address);
};

const isPublicHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  const isIpLiteral = /^[\d.]+$/.test(host) || host.includes(":");
  const isLocalName =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal");
  return !isIpLiteral && !isLocalName && host.includes(".");
};

export const isAllowedTarget = (url: URL): boolean => {
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    isPublicHostname(url.hostname)
  );
};

export class EgressPolicyError extends Error {
  override readonly name = "EgressPolicyError";
}

export interface SafeFetchResult {
  status: number;
  text: string;
  contentType: string | null;
}

export interface HopResponse extends SafeFetchResult {
  location: string | null;
}

export interface Transport {
  lookup: (hostname: string) => Promise<LookupAddress[]>;
  request: (url: URL, addresses: LookupAddress[]) => Promise<HopResponse>;
}

// net.connect asks for every address when it may pick between IPv4 and IPv6
// (options.all) and for a single one otherwise.
const pinnedLookup =
  (addresses: LookupAddress[]): LookupFunction =>
  (_hostname, options, callback) => {
    const [first] = addresses;
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  };

const pinnedTransport: Transport = {
  lookup: (hostname) => dns.lookup(hostname, { all: true }),
  request: async (url, addresses) => {
    const agent = new Agent({
      connect: { lookup: pinnedLookup(addresses) },
      maxResponseSize: MAX_BODY_BYTES,
    });
    try {
      const response = await fetch(url, {
        dispatcher: agent,
        redirect: "manual",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
      return {
        status: response.status,
        text: await response.text(),
        contentType: response.headers.get("content-type"),
        location: response.headers.get("location"),
      };
    } finally {
      await agent.close();
    }
  },
};

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

const fetchHop = async (
  url: URL,
  transport: Transport,
): Promise<HopResponse> => {
  if (!isAllowedTarget(url)) {
    throw new EgressPolicyError(`Target not allowed: ${url.origin}`);
  }
  const addresses = await transport.lookup(url.hostname);
  if (
    addresses.length === 0 ||
    !addresses.every((entry) => isPublicAddress(entry.address))
  ) {
    throw new EgressPolicyError(
      `${url.hostname} resolves to a non-public address`,
    );
  }
  return transport.request(url, addresses);
};

// Every hop, including redirect targets, is checked syntactically, resolved,
// checked by address, and then connected to exactly the resolved addresses.
export const safeFetch = async (
  url: URL,
  transport: Transport = pinnedTransport,
): Promise<SafeFetchResult> => {
  let target = url;
  for (let redirects = 0; ; redirects += 1) {
    const { location, ...result } = await fetchHop(target, transport);
    if (!REDIRECT_STATUSES.includes(result.status) || location === null) {
      return result;
    }
    if (redirects === MAX_REDIRECTS) {
      throw new EgressPolicyError("Too many redirects");
    }
    target = new URL(location, target);
  }
};
