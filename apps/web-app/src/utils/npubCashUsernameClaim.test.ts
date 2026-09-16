import {
  makeLightningInvoice,
  invoiceTimestamp,
} from "../testUtils/lightningInvoice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finalizeOwnLightningAddressClaim,
  getOwnLightningAddressInputCandidate,
  getOwnLightningAddressFromUsername,
  getOwnLightningUsernameValidationIssue,
  normalizeOwnLightningUsername,
  requestOwnLightningAddressClaimPreview,
  purchaseOwnLightningAddressClaim,
  type OwnLightningClaimAvailableResult,
} from "./npubCashUsernameClaim";

describe("npubCashUsernameClaim", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(invoiceTimestamp * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes usernames and validates the hosted format", () => {
    expect(normalizeOwnLightningUsername(" Alice42 ")).toBe("alice42");
    expect(getOwnLightningAddressFromUsername("Alice42")).toBe(
      "alice42@linky.fit",
    );
    expect(getOwnLightningUsernameValidationIssue("ab")).toBe("too_short");
    expect(getOwnLightningUsernameValidationIssue("alice-42")).toBe(
      "invalid_format",
    );
    expect(getOwnLightningUsernameValidationIssue("alice42")).toBeNull();
  });

  it("treats bare names as linky.fit lightning address candidates", () => {
    expect(getOwnLightningAddressInputCandidate(" Alice42 ")).toEqual({
      issue: null,
      lightningAddress: "alice42@linky.fit",
      username: "alice42",
    });
    expect(getOwnLightningAddressInputCandidate("Alice42@Linky.Fit")).toEqual({
      issue: null,
      lightningAddress: "alice42@linky.fit",
      username: "alice42",
    });
    expect(
      getOwnLightningAddressInputCandidate("alice@example.com"),
    ).toBeNull();
  });

  it("parses payment-required username previews", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                paymentRequest: makeLightningInvoice(),
                paymentToken: "payment-token-1",
              },
              error: true,
              message: "Payment required",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 402,
            },
          ),
      ),
    );

    const result = await requestOwnLightningAddressClaimPreview({
      makeNip98AuthHeader: async () => "nip98-token",
      serverBaseUrl: "https://npub.linky.fit",
      username: "Alice42",
    });

    expect(result.kind).toBe("available");
    if (result.kind !== "available") return;
    expect(result.username).toBe("alice42");
    expect(result.lightningAddress).toBe("alice42@linky.fit");
    expect(result.paymentToken).toBe("payment-token-1");
    expect(result.invoice.invoice).toBe(makeLightningInvoice());
  });

  it("parses username previews that are already set for the signed account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: true,
              message: "Username already set",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 400,
            },
          ),
      ),
    );

    const result = await requestOwnLightningAddressClaimPreview({
      makeNip98AuthHeader: async () => "nip98-token",
      serverBaseUrl: "https://npub.linky.fit",
      username: "Alice42",
    });

    expect(result).toEqual({
      kind: "already_set",
      message: "Username already set",
    });
  });

  it("treats repeated finalize responses as already set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: true,
              message: "Username already set",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 400,
            },
          ),
      ),
    );

    const result = await finalizeOwnLightningAddressClaim({
      makeNip98AuthHeader: async () => "nip98-token",
      paymentToken: "payment-token-1",
      serverBaseUrl: "https://npub.linky.fit",
      username: "alice42",
    });

    expect(result).toEqual({ kind: "already_set" });
  });
});

describe("purchaseOwnLightningAddressClaim", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(invoiceTimestamp * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const preview = (): OwnLightningClaimAvailableResult => ({
    kind: "available",
    username: "alice",
    lightningAddress: "alice@linky.fit",
    paymentToken: "original-token",
    invoice: {
      invoice: makeLightningInvoice(),
      amountSat: 2000,
      expiresAtSec: invoiceTimestamp + 3600,
      description: "Username purchase",
    },
  });

  it.each(["lnbc1invalid", makeLightningInvoice("")])(
    "rejects invalid invoice %s even if a caller supplies a numeric preview",
    async (invoice) => {
      const pay = vi.fn(async () => true);
      const result = await purchaseOwnLightningAddressClaim({
        availableBalanceSat: 5000,
        preview: { ...preview(), invoice: { ...preview().invoice, invoice } },
        makeNip98AuthHeader: async () => "auth",
        payLightningInvoiceWithCashu: pay,
        saveClaimedLightningAddress: async () => true,
        serverBaseUrl: "https://npub.linky.fit",
      });
      expect(result.kind).toBe("error");
      expect(pay).not.toHaveBeenCalled();
    },
  );

  it("rejects insufficient balance even if the UI guard is bypassed", async () => {
    const pay = vi.fn(async () => true);
    expect(
      await purchaseOwnLightningAddressClaim({
        availableBalanceSat: 1999,
        preview: preview(),
        makeNip98AuthHeader: async () => "auth",
        payLightningInvoiceWithCashu: pay,
        saveClaimedLightningAddress: async () => true,
        serverBaseUrl: "https://npub.linky.fit",
      }),
    ).toEqual({ kind: "error", message: "Insufficient balance" });
    expect(pay).not.toHaveBeenCalled();
  });

  it("freezes the approved claim across asynchronous payment", async () => {
    const approved = preview();
    const originalInvoice = approved.invoice.invoice;
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ error: false })),
    );
    vi.stubGlobal("fetch", fetcher);
    const save = vi.fn(async () => true);
    const pay = vi.fn(async () => {
      approved.paymentToken = "substituted-token";
      approved.username = "mallory";
      approved.lightningAddress = "mallory@linky.fit";
      approved.invoice.invoice = makeLightningInvoice("40u");
      return true;
    });
    expect(
      await purchaseOwnLightningAddressClaim({
        availableBalanceSat: 5000,
        preview: approved,
        makeNip98AuthHeader: async () => "auth",
        payLightningInvoiceWithCashu: pay,
        saveClaimedLightningAddress: save,
        serverBaseUrl: "https://npub.linky.fit",
      }),
    ).toEqual({ kind: "success" });
    expect(pay).toHaveBeenCalledWith(originalInvoice);
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          paymentToken: "original-token",
          username: "alice",
        }),
      }),
    );
    expect(save).toHaveBeenCalledWith("alice@linky.fit");
  });
});
