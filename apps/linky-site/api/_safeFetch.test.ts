import { describe, expect, it } from "vitest";

import {
  EgressPolicyError,
  isAllowedTarget,
  isPublicAddress,
  safeFetch,
  type HopResponse,
  type Transport,
} from "./_safeFetch.js";

describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0",
    "127.0.0.1",
    "10.1.2.3",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1",
    "fe80::",
    "fe80::1%eth0",
    "fc00::",
    "fd12:3456::1",
    "ff02::1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "not-an-ip",
    "",
  ])("rejects %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "104.20.23.154",
    "2606:4700:4700::1111",
    "2a00:1450:4001:80b::200e",
  ])("accepts %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe("isAllowedTarget", () => {
  it.each([
    "http://pay.example.com/.well-known/lnurlp/alice",
    "https://127.0.0.1/.well-known/lnurlp/alice",
    "https://[::1]/.well-known/lnurlp/alice",
    "https://localhost/.well-known/lnurlp/alice",
    "https://wallet.localhost/x",
    "https://printer.local/x",
    "https://metadata.internal/x",
    "https://pay.example.com:8443/x",
    "https://user:pw@pay.example.com/x",
    "https://nodots/x",
  ])("rejects %s", (url) => {
    expect(isAllowedTarget(new URL(url))).toBe(false);
  });

  it("accepts a plain https host, so resolved addresses must be checked too", () => {
    expect(isAllowedTarget(new URL("https://pay.example.com/x"))).toBe(true);
    expect(isAllowedTarget(new URL("https://127.0.0.1.nip.io/x"))).toBe(true);
  });
});

interface FakeNetwork {
  addresses: Record<string, string[]>;
  responses: Record<string, Partial<HopResponse>>;
}

const fakeTransport = (
  network: FakeNetwork,
): Transport & { requested: string[] } => {
  const requested: string[] = [];
  return {
    requested,
    lookup: async (hostname) =>
      (network.addresses[hostname] ?? []).map((address) => ({
        address,
        family: address.includes(":") ? 6 : 4,
      })),
    request: async (url) => {
      requested.push(url.href);
      const response = network.responses[url.href];
      if (!response) throw new Error(`unexpected request to ${url.href}`);
      return {
        status: 200,
        text: "",
        contentType: null,
        location: null,
        ...response,
      };
    },
  };
};

const redirect = (location: string): Partial<HopResponse> => ({
  status: 302,
  location,
});

describe("safeFetch", () => {
  it("returns the final response of a public host", async () => {
    const transport = fakeTransport({
      addresses: { "pay.example.com": ["93.184.216.34", "2606:2800:220:1::1"] },
      responses: {
        "https://pay.example.com/x": {
          text: '{"ok":true}',
          contentType: "application/json",
        },
      },
    });

    await expect(
      safeFetch(new URL("https://pay.example.com/x"), transport),
    ).resolves.toEqual({
      status: 200,
      text: '{"ok":true}',
      contentType: "application/json",
    });
  });

  it("rejects before connecting when the host resolves to a private address", async () => {
    const transport = fakeTransport({
      addresses: { "127.0.0.1.nip.io": ["127.0.0.1"] },
      responses: {},
    });

    await expect(
      safeFetch(new URL("https://127.0.0.1.nip.io/x"), transport),
    ).rejects.toThrow(EgressPolicyError);
    expect(transport.requested).toEqual([]);
  });

  it("rejects when any resolved address is private", async () => {
    const transport = fakeTransport({
      addresses: { "pay.example.com": ["93.184.216.34", "10.0.0.5"] },
      responses: {},
    });

    await expect(
      safeFetch(new URL("https://pay.example.com/x"), transport),
    ).rejects.toThrow(EgressPolicyError);
    expect(transport.requested).toEqual([]);
  });

  it("rejects a host with no addresses", async () => {
    const transport = fakeTransport({ addresses: {}, responses: {} });

    await expect(
      safeFetch(new URL("https://pay.example.com/x"), transport),
    ).rejects.toThrow(EgressPolicyError);
  });

  it("rejects a redirect to a private target without connecting to it", async () => {
    const transport = fakeTransport({
      addresses: {
        "pay.example.com": ["93.184.216.34"],
        "169.254.169.254.nip.io": ["169.254.169.254"],
      },
      responses: {
        "https://pay.example.com/x": redirect(
          "https://169.254.169.254.nip.io/latest/meta-data/",
        ),
      },
    });

    await expect(
      safeFetch(new URL("https://pay.example.com/x"), transport),
    ).rejects.toThrow(/non-public/);
    expect(transport.requested).toEqual(["https://pay.example.com/x"]);
  });

  it("rejects a redirect that downgrades to http", async () => {
    const transport = fakeTransport({
      addresses: { "pay.example.com": ["93.184.216.34"] },
      responses: {
        "https://pay.example.com/x": redirect("http://pay.example.com/x"),
      },
    });

    await expect(
      safeFetch(new URL("https://pay.example.com/x"), transport),
    ).rejects.toThrow(/not allowed/);
  });

  it("follows up to three redirects, resolving relative locations", async () => {
    const transport = fakeTransport({
      addresses: { "pay.example.com": ["93.184.216.34"] },
      responses: {
        "https://pay.example.com/1": redirect("/2"),
        "https://pay.example.com/2": { status: 301, location: "/3" },
        "https://pay.example.com/3": { status: 308, location: "/4" },
        "https://pay.example.com/4": { text: "done" },
      },
    });

    await expect(
      safeFetch(new URL("https://pay.example.com/1"), transport),
    ).resolves.toMatchObject({ status: 200, text: "done" });
    expect(transport.requested).toHaveLength(4);
  });

  it("rejects a redirect chain longer than three hops", async () => {
    const transport = fakeTransport({
      addresses: { "pay.example.com": ["93.184.216.34"] },
      responses: {
        "https://pay.example.com/1": redirect("/2"),
        "https://pay.example.com/2": redirect("/3"),
        "https://pay.example.com/3": redirect("/4"),
        "https://pay.example.com/4": redirect("/5"),
        "https://pay.example.com/5": { text: "never" },
      },
    });

    await expect(
      safeFetch(new URL("https://pay.example.com/1"), transport),
    ).rejects.toThrow(/Too many redirects/);
    expect(transport.requested).toHaveLength(4);
  });

  it("passes a redirect status without a location through as the result", async () => {
    const transport = fakeTransport({
      addresses: { "pay.example.com": ["93.184.216.34"] },
      responses: { "https://pay.example.com/x": { status: 302, text: "odd" } },
    });

    await expect(
      safeFetch(new URL("https://pay.example.com/x"), transport),
    ).resolves.toMatchObject({ status: 302, text: "odd" });
  });
});
