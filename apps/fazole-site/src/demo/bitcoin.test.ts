import { decodePaymentRequest } from "@linky-fit/linkshu";
import { decode } from "nostr-tools/nip19";
import { afterEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "../config";
import { bitcoinQrValue, buildCashuRequest, fetchInvoice } from "./bitcoin";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

const payRequest = {
  callback: "https://linky.fit/callback",
  minSendable: 1000,
  maxSendable: 10_000_000,
  tag: "payRequest",
};

afterEach(() => vi.unstubAllGlobals());

describe("the demo's Bitcoin leg", () => {
  it("asks the support account for the sats over Nostr, named by the payment id", () => {
    const request = decodePaymentRequest(buildCashuRequest(250, "payment-1"));
    expect(request).toMatchObject({
      amount: 250,
      unit: "sat",
      singleUse: true,
      mints: [],
      id: "payment-1",
    });
    const transport = request?.transports[0];
    expect(transport?.type).toBe("nostr");
    expect(transport?.tags).toEqual([["n", "17"]]);
    const profile = decode(transport?.target ?? "");
    if (profile.type !== "nprofile") throw new Error("expected an nprofile");
    const support = decode(siteConfig.supportNpub);
    expect(profile.data.pubkey).toBe(support.data);
    expect(profile.data.relays).toEqual(siteConfig.supportRelays);
  });

  it("takes the invoice through the Lightning address's two hops, in millisats", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(
        url.includes("/.well-known/lnurlp/")
          ? json(payRequest)
          : json({ pr: "lnbc2500n1invoice" }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(fetchInvoice(250, signal)).resolves.toBe("lnbc2500n1invoice");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `https://${siteConfig.lightningAddressHost}/.well-known/lnurlp/${siteConfig.supportNpub}`,
      "https://linky.fit/callback?amount=250000",
    ]);
  });

  it("refuses an amount the address does not accept instead of asking for it", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json(payRequest)));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(fetchInvoice(20_000, signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("puts both legs into one bitcoin: URI", () => {
    const value = bitcoinQrValue({
      invoice: "lnbc1abc",
      request: "creqAxyz",
      sats: 1,
    });
    expect(value).toBe("bitcoin:?lightning=lnbc1abc&creq=creqAxyz");
  });
});
