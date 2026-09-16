import { BlockList, isIPv4, SocketAddress, type IPVersion } from "node:net";

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
  ["2001::", 23], // IETF assignments, including Teredo and benchmarking
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, embeds an arbitrary IPv4 address
  ["3fff::", 20], // documentation
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

export function parsePushEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Push endpoint must be a public HTTPS URL");
  }
  if (endpoint.length > 4096 || !isAllowedTarget(url) || url.hash !== "") {
    throw new Error(
      "Push endpoint must be a public HTTPS URL on port 443 without credentials or fragment",
    );
  }
  return url;
}
