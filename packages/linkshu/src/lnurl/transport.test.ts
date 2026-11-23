import { bech32 } from "@scure/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLnurlJson } from "./common";
import { parseLnurlAuthTarget, submitLnurlAuth } from "./lnurlAuth";
import {
  fetchLnurlInvoiceForTarget,
  fetchLnurlPayPreview,
  fetchLnurlWithdrawPreview,
  isLnurlPayTarget,
  isLnurlWithdrawTarget,
  redeemLnurlWithdraw,
  resolveLnurlPayRequestUrl,
} from "./lnurlPay";

const encodeLnurl = (url: string) =>
  bech32.encode("lnurl", bech32.toWords(new TextEncoder().encode(url)), 2048);
const k1 = "a".repeat(64);
const payRequest = (callback: string) => ({
  tag: "payRequest",
  callback,
  minSendable: 1000,
  maxSendable: 1000,
  metadata: '[["text/plain","payment"]]',
});
const withdrawRequest = (callback: string) => ({
  tag: "withdrawRequest",
  callback,
  k1,
  minWithdrawable: 1000,
  maxWithdrawable: 1000,
});

afterEach(() => vi.restoreAllMocks());

describe("LNURL HTTPS policy", () => {
  it.each([
    "http://example.com/pay",
    "http://localhost/pay",
    "http://127.0.0.1/pay",
    "http://[::1]/pay",
    "ftp://example.com/pay",
    encodeLnurl("http://example.com/pay"),
    "lightning:http://example.com/pay",
  ])("rejects insecure targets before any transport: %s", async (target) => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected fetch"));
    const fallback = vi.fn();
    expect(isLnurlPayTarget(target)).toBe(false);
    expect(isLnurlWithdrawTarget(target)).toBe(false);
    await expect(fetchLnurlPayPreview(target, fallback)).rejects.toThrow();
    await expect(fetchLnurlWithdrawPreview(target, fallback)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    "http://example.com/auth",
    "http://localhost/auth",
    "ftp://example.com/auth",
  ])("rejects insecure auth targets and supplied previews: %s", async (url) => {
    const requestUrl = `${url}?tag=login&k1=${k1}`;
    expect(parseLnurlAuthTarget(requestUrl)).toBeNull();
    expect(parseLnurlAuthTarget(encodeLnurl(requestUrl))).toBeNull();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected fetch"));
    const fallback = vi.fn();
    const sign = vi.fn(() => ({ publicKeyHex: "key", signatureHex: "sig" }));
    await expect(
      submitLnurlAuth(
        {
          preview: { action: "login", domain: "example.com", k1, requestUrl },
          sign,
        },
        fallback,
      ),
    ).rejects.toThrow("HTTPS");
    expect(sign).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(["http://example.com/callback", "javascript:alert(1)"])(
    "rejects insecure pay and withdraw callbacks: %s",
    async (callback) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Unexpected fetch"));
      const fallback = vi.fn();
      fetchSpy.mockResolvedValueOnce(Response.json(payRequest(callback)));
      await expect(
        fetchLnurlInvoiceForTarget("alice@example.com", 1, undefined, fallback),
      ).rejects.toThrow("HTTPS");
      fetchSpy.mockResolvedValueOnce(Response.json(withdrawRequest(callback)));
      await expect(
        fetchLnurlWithdrawPreview("https://example.com/withdraw", fallback),
      ).rejects.toThrow("HTTPS");
      await expect(
        redeemLnurlWithdraw(
          { callback, invoice: "lnbc10n1test", k1 },
          fallback,
        ),
      ).rejects.toThrow("HTTPS");
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it("keeps secure encoded targets and scheme shortcuts", async () => {
    expect(
      resolveLnurlPayRequestUrl(encodeLnurl("https://example.com//pay")),
    ).toBe("https://example.com/pay");
    expect(resolveLnurlPayRequestUrl("lnurlp://example.com/pay")).toBe(
      "https://example.com/pay",
    );
    expect(resolveLnurlPayRequestUrl("lnurlp://alice@example.com")).toBe(
      "https://example.com/.well-known/lnurlp/alice",
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(withdrawRequest("https://example.com/callback")),
      );
    await expect(
      fetchLnurlWithdrawPreview("lnurlw://example.com/withdraw"),
    ).resolves.toMatchObject({ amountSat: 1 });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/withdraw",
      expect.anything(),
    );
    expect(
      parseLnurlAuthTarget(`keyauth://example.com/auth?tag=login&k1=${k1}`)
        ?.requestUrl,
    ).toBe(`https://example.com/auth?tag=login&k1=${k1}`);
  });

  it("never sends an insecure URL to a fallback", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected fetch"));
    const fallback = vi.fn();
    await expect(
      fetchLnurlJson("http://example.com", fallback),
    ).rejects.toThrow("HTTPS");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("validates redirects before sending the next request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/callback" },
      }),
    );
    const fallback = vi.fn();
    await expect(
      fetchLnurlJson("https://example.com/pay", fallback),
    ).rejects.toThrow("HTTPS");
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      "https://example.com/pay",
      {
        headers: { Accept: "application/json" },
        redirect: "manual",
      },
    );
    expect(fallback).not.toHaveBeenCalled();
  });

  it("follows visible HTTPS and relative redirects", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 301, headers: { Location: "/next" } }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { Location: "https://pay.example.com/final" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ status: "OK" }));
    await expect(fetchLnurlJson("https://example.com/pay")).resolves.toEqual({
      status: "OK",
    });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/pay",
      "https://example.com/next",
      "https://pay.example.com/final",
    ]);
    expect(
      fetchSpy.mock.calls.every(
        ([, options]) => options?.redirect === "manual",
      ),
    ).toBe(true);
  });

  it("bounds redirect loops", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () =>
          new Response(null, { status: 302, headers: { Location: "/again" } }),
      );
    await expect(fetchLnurlJson("https://example.com/pay")).rejects.toThrow(
      "redirect",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("preserves fallback for CORS failures and browser-opaque redirects", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.error());
    const fallback = vi.fn(async () => Response.json({ status: "OK" }));
    await expect(
      fetchLnurlJson("https://example.com/pay", fallback),
    ).resolves.toEqual({ status: "OK" });
    await expect(
      fetchLnurlJson("https://example.com/pay", fallback),
    ).resolves.toEqual({ status: "OK" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fallback.mock.calls).toHaveLength(2);
  });
});

describe("LNURL-pay comments (LUD-12)", () => {
  const invoiceResponse = () => Response.json({ pr: "lnbc10n1testinvoice" });
  const callback = "https://example.com/callback";
  const invoiceUrl = (fetchSpy: ReturnType<typeof vi.spyOn>, call: number) =>
    new URL(String(fetchSpy.mock.calls[call]?.[0]));

  it("sends the comment, cut to commentAllowed, when the provider advertises it", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ ...payRequest(callback), commentAllowed: 5 }),
      )
      .mockResolvedValueOnce(invoiceResponse());

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1, "coffee money"),
    ).resolves.toMatchObject({ pr: "lnbc10n1testinvoice" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(invoiceUrl(fetchSpy, 1).searchParams.get("comment")).toBe("coffe");
  });

  it("surfaces a rejected comment instead of paying without it", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ ...payRequest(callback), commentAllowed: 100 }),
      )
      .mockResolvedValueOnce(
        Response.json({ status: "ERROR", reason: "comment refused" }),
      );

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1, "coffee"),
    ).rejects.toThrow("comment refused");
  });

  it("tries a comment once on a provider that does not advertise it, then retries bare", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(Response.json({ status: "ERROR", reason: "no" }))
      .mockResolvedValueOnce(invoiceResponse());

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1, "coffee"),
    ).resolves.toMatchObject({ pr: "lnbc10n1testinvoice" });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(invoiceUrl(fetchSpy, 1).searchParams.get("comment")).toBe("coffee");
    expect(invoiceUrl(fetchSpy, 2).searchParams.has("comment")).toBe(false);
  });

  it("asks for a bare invoice when there is no comment", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ ...payRequest(callback), commentAllowed: 100 }),
      )
      .mockResolvedValueOnce(invoiceResponse());

    await fetchLnurlInvoiceForTarget("alice@example.com", 1);

    expect(invoiceUrl(fetchSpy, 1).searchParams.has("comment")).toBe(false);
  });
});

describe("LNURL-pay BOLT11 amount verification (LUD-06)", () => {
  const callback = "https://example.com/callback";

  it("rejects an amountless BOLT11 invoice from the callback", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(Response.json({ pr: "lnbc1testinvoice" }));

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1),
    ).rejects.toThrow("LNURL invoice missing amount");
  });

  it("rejects a non-BOLT11 invoice string from the callback", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(Response.json({ pr: "10n1notbolt11" }));

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1),
    ).rejects.toThrow("LNURL invoice missing amount");
  });

  it("rejects a BOLT11 invoice whose amount does not match the requested amount", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(Response.json({ pr: "lnbc20n1testinvoice" }));

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1),
    ).rejects.toThrow("LNURL invoice amount mismatch");
  });

  it("rejects a BOLT11 invoice with a sub-millisatoshi fractional amount", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(Response.json({ pr: "lnbc9999p1testinvoice" }));

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1),
    ).rejects.toThrow("LNURL invoice missing amount");
  });

  it("accepts a BOLT11 invoice whose explicit amount matches the request", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(Response.json({ pr: "lnbc10n1testinvoice" }));

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1),
    ).resolves.toMatchObject({ pr: "lnbc10n1testinvoice" });
  });

  it("accepts a matching regtest lnbcrt invoice from the callback", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(Response.json({ pr: "lnbcrt10n1testinvoice" }));

    await expect(
      fetchLnurlInvoiceForTarget("alice@example.com", 1),
    ).resolves.toMatchObject({ pr: "lnbcrt10n1testinvoice" });
  });
});

describe("LNURL-pay with a confirmed preview", () => {
  const callback = "https://example.com/callback";
  const invoiceResponse = () => Response.json({ pr: "lnbc10n1testinvoice" });
  const requestedPaths = () =>
    vi
      .mocked(fetch)
      .mock.calls.map(([input]) => new URL(String(input)).pathname);

  const previewOf = async (target: string) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(payRequest(callback)),
    );
    const preview = await fetchLnurlPayPreview(target);
    vi.restoreAllMocks();
    return preview;
  };

  it("asks the callback for the invoice without refetching the pay request", async () => {
    const preview = await previewOf("alice@example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(invoiceResponse());

    await expect(
      fetchLnurlInvoiceForTarget(
        "alice@example.com",
        1,
        undefined,
        undefined,
        preview,
      ),
    ).resolves.toMatchObject({ pr: "lnbc10n1testinvoice" });

    expect(requestedPaths()).toEqual(["/callback"]);
  });

  it("refetches the pay request when the confirmed one's callback fails", async () => {
    const preview = await previewOf("alice@example.com");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({ status: "ERROR", reason: "expired" }),
      )
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(invoiceResponse());

    await expect(
      fetchLnurlInvoiceForTarget(
        "alice@example.com",
        1,
        undefined,
        undefined,
        preview,
      ),
    ).resolves.toMatchObject({ pr: "lnbc10n1testinvoice" });

    expect(requestedPaths()).toEqual([
      "/callback",
      "/.well-known/lnurlp/alice",
      "/callback",
    ]);
  });

  it("ignores a preview of another target", async () => {
    const preview = await previewOf("bob@example.com");
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(payRequest(callback)))
      .mockResolvedValueOnce(invoiceResponse());

    await fetchLnurlInvoiceForTarget(
      "alice@example.com",
      1,
      undefined,
      undefined,
      preview,
    );

    expect(requestedPaths()).toEqual([
      "/.well-known/lnurlp/alice",
      "/callback",
    ]);
  });
});
