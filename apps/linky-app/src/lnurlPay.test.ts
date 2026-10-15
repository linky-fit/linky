import { bech32 } from "@scure/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLnurlInvoiceForTarget,
  fetchLnurlPayPreview,
  fetchLnurlWithdrawPreview,
  getLnurlPayDisplayText,
  inferLightningAddressFromLnurlTarget,
  isLightningAddress,
  LnurlTagMismatchError,
  redeemLnurlWithdraw,
  resolveLnurlPayRequestUrl,
} from "./lnurlPay";

const encodeLnurl = (url: string): string => {
  const bytes = new TextEncoder().encode(url);
  return bech32.encode("lnurl", bech32.toWords(bytes), 2000).toUpperCase();
};

describe("LNURL-pay lightning address metadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not treat an LNbits pay-link ID as a lightning address", async () => {
    const target = encodeLnurl("https://lnbits.cz/lnurlp//KfCp5v");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          callback: "https://lnbits.cz/lnurlp/api/v1/lnurl/cb/KfCp5v",
          maxSendable: 3000,
          metadata: '[["text/plain", "testík"]]',
          minSendable: 3000,
          tag: "payRequest",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    expect(inferLightningAddressFromLnurlTarget(target)).toBeNull();
    await expect(fetchLnurlPayPreview(target)).resolves.toMatchObject({
      lightningAddress: null,
    });
  });

  it("uses a text/identifier lightning address from LNURL metadata", async () => {
    const target = encodeLnurl("https://lnbits.cz/lnurlp//jn32N6");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          callback: "https://lnbits.cz/lnurlp/api/v1/lnurl/cb/jn32N6",
          maxSendable: 5000,
          metadata:
            '[["text/plain", "Payment to testik"], ["text/identifier", "testik@lnbits.cz"]]',
          minSendable: 5000,
          tag: "payRequest",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(fetchLnurlPayPreview(target)).resolves.toMatchObject({
      lightningAddress: "testik@lnbits.cz",
    });
  });

  it("returns the metadata address with the invoice used for payment", async () => {
    const target = encodeLnurl("https://lnbits.cz/lnurlp//jn32N6");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          callback: "https://lnbits.cz/lnurlp/api/v1/lnurl/cb/jn32N6",
          maxSendable: 5000,
          metadata:
            '[["text/plain", "Payment to testik"], ["text/identifier", "testik@lnbits.cz"]]',
          minSendable: 5000,
          tag: "payRequest",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ pr: "lnbc1testinvoice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(fetchLnurlInvoiceForTarget(target, 5)).resolves.toMatchObject({
      lightningAddress: "testik@lnbits.cz",
    });
  });
});

describe("LNURL-pay request resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lowercases a lightning address when building the well-known URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          callback: "https://21m.lol/lnurlp/api/v1/lnurl/cb/hDBYoW",
          maxSendable: 10000000000,
          metadata: '[["text/plain", "Payment to plex"]]',
          minSendable: 1000,
          tag: "payRequest",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(fetchLnurlPayPreview("Plex@21m.lol")).resolves.toMatchObject({
      minSendableSat: 1,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://21m.lol/.well-known/lnurlp/plex",
    );
  });

  it("surfaces the server error reason instead of a tag mismatch", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ERROR",
          reason: "Lightning address not found.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(fetchLnurlPayPreview("missing@21m.lol")).rejects.toThrow(
      "Lightning address not found.",
    );
  });
});

describe("fetchLnurlInvoiceForTarget fixed-amount re-quotes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockPayRequestThenInvoice = (fixedMsat: number) => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          callback: "https://lnbits.cz/lnurlp/api/v1/lnurl/cb/KfCp5v",
          maxSendable: fixedMsat,
          metadata: '[["text/plain", "Fixed price"]]',
          minSendable: fixedMsat,
          tag: "payRequest",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ pr: "lnbc1testinvoice" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    return fetchMock;
  };

  it("follows a slightly drifted fixed quote (fiat re-quote)", async () => {
    const fetchMock = mockPayRequestThenInvoice(4360500);

    await expect(
      fetchLnurlInvoiceForTarget("fixed@lnbits.cz", 4352),
    ).resolves.toMatchObject({ pr: "lnbc1testinvoice" });

    const invoiceUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(invoiceUrl.searchParams.get("amount")).toBe("4360500");
  });

  it("rejects a fixed quote that drifted too far from the confirmed amount", async () => {
    mockPayRequestThenInvoice(5000000);

    await expect(
      fetchLnurlInvoiceForTarget("fixed@lnbits.cz", 4352),
    ).rejects.toThrow("Amount out of LNURL range");
  });
});

describe("fetchLnurlWithdrawPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the max withdrawable amount in sats", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          callback: "https://withdraw.example/cb",
          defaultDescription: "Voucher",
          k1: "nonce-1",
          maxWithdrawable: 21000,
          minWithdrawable: 21000,
          tag: "withdrawRequest",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      fetchLnurlWithdrawPreview("lnurlw://withdraw.example/lnurl"),
    ).resolves.toMatchObject({
      amountSat: 21,
      callback: "https://withdraw.example/cb",
      description: "Voucher",
      k1: "nonce-1",
      maxAmountSat: 21,
      minAmountSat: 21,
      target: "withdraw.example/lnurl",
    });
  });

  it("accepts a lightning-prefixed bech32 LNURL-withdraw QR", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          callback: "https://withdraw.example/cb",
          defaultDescription: "Voucher",
          k1: "nonce-1",
          maxWithdrawable: 21000,
          minWithdrawable: 21000,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const lnurl = encodeLnurl("https://withdraw.example/lnurl");

    await expect(
      fetchLnurlWithdrawPreview(`lightning:${lnurl}`),
    ).resolves.toMatchObject({
      amountSat: 21,
      target: "withdraw.example/lnurl",
    });
  });

  it("throws a tag mismatch error for LNURL-pay metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          callback: "https://pay.example/cb",
          maxSendable: 1000,
          minSendable: 1000,
          tag: "payRequest",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      fetchLnurlWithdrawPreview("lnurlw://pay.example/lnurl"),
    ).rejects.toBeInstanceOf(LnurlTagMismatchError);
  });
});

describe("redeemLnurlWithdraw", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the withdraw callback with k1 and invoice", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "OK" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      redeemLnurlWithdraw({
        callback: "https://withdraw.example/cb?foo=bar",
        invoice: "lnbc1testinvoice",
        k1: "nonce-2",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://withdraw.example/cb?foo=bar&k1=nonce-2&pr=lnbc1testinvoice",
    );
  });
});

describe("LNURL-pay target helpers", () => {
  it("recognizes lightning addresses", () => {
    expect(isLightningAddress("alice@example.com")).toBe(true);
    expect(
      isLightningAddress("https://example.com/.well-known/lnurlp/alice"),
    ).toBe(false);
  });

  it("resolves lowercase LNURL bech32 targets to request URLs", () => {
    const requestUrl = "https://pay.example.com/lnurl/callback";

    expect(
      resolveLnurlPayRequestUrl(encodeLnurl(requestUrl).toLowerCase()),
    ).toBe(requestUrl);
  });

  it("builds a readable display label for LNURL targets", () => {
    expect(
      getLnurlPayDisplayText("https://pay.example.com/lnurl/callback"),
    ).toBe("pay.example.com/lnurl/callback");
  });

  it("infers a lightning address from well-known LNURL pay urls", () => {
    expect(
      inferLightningAddressFromLnurlTarget(
        "https://walletofsatoshi.com/.well-known/lnurlp/poorjames425",
      ),
    ).toBe("poorjames425@walletofsatoshi.com");
  });

  it("supports lnurlp scheme with a lightning address target", () => {
    expect(
      resolveLnurlPayRequestUrl("lnurlp://poorjames425@walletofsatoshi.com"),
    ).toBe("https://walletofsatoshi.com/.well-known/lnurlp/poorjames425");
  });
});
