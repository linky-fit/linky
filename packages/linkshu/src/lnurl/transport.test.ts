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
