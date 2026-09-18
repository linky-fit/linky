import { bech32 } from "@scure/base";
import { Effect } from "effect";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { LnurlAuthPreview } from "../../lnurlAuth";
import type { Translate } from "../../i18n";
import { useScannedTextHandler } from "./useScannedTextHandler";

const K1 = "b".repeat(64);
const LOGIN_URL = `https://example.com/lnurl-auth?tag=login&k1=${K1}&action=login`;
const PAY_URL = "https://example.com/lnurlp/alice";

const encodeLnurl = (url: string): string => {
  const bytes = new TextEncoder().encode(url);
  return bech32.encode("lnurl", bech32.toWords(bytes), 2000).toUpperCase();
};

type ScannedTextHandler = ReturnType<typeof useScannedTextHandler>;

interface Scan {
  handle: (text: string) => Promise<void>;
  requestLnurlAuthConfirmation: ReturnType<typeof vi.fn>;
  requestLnurlWithdrawConfirmation: ReturnType<typeof vi.fn>;
}

const translateToKey: Translate = (key) => key;

const setup = async (): Promise<Scan> => {
  const requestLnurlAuthConfirmation = vi.fn<(p: LnurlAuthPreview) => void>();
  const requestLnurlWithdrawConfirmation = vi.fn();
  const handlerRef: { current: ScannedTextHandler | null } = { current: null };

  const Probe = (): null => {
    const handle = useScannedTextHandler({
      closeScan: () => undefined,
      contacts: [],
      contactsRepository: { insert: () => Effect.void },
      currentNpub: null,
      extractCashuTokenFromText: () => null,
      lightningInvoiceAutoPayLimit: 0,
      onContactIdentifierScanned: null,
      openScannedContactPendingNpubRef: { current: null },
      payCashuPaymentRequest: async () => undefined,
      payLightningInvoiceWithCashu: async () => false,
      requestLightningInvoiceConfirmation: () => undefined,
      requestLnurlAuthConfirmation,
      requestLnurlWithdrawConfirmation,
      saveCashuFromText: async () => undefined,
      scanAcceptsBankPayment: false,
      scanEntryPoint: null,
      setStatus: () => undefined,
      t: translateToKey,
    });

    React.useEffect(() => {
      handlerRef.current = handle;
    }, [handle]);
    return null;
  };

  await renderIntoDocument(<Probe />);
  const handle = handlerRef.current;
  if (!handle) throw new Error("scan handler did not mount");

  return {
    handle,
    requestLnurlAuthConfirmation,
    requestLnurlWithdrawConfirmation,
  };
};

describe("scanned LNURL-auth targets", () => {
  it("confirms a login without probing it as a withdraw target", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const scan = await setup();

    await scan.handle(encodeLnurl(LOGIN_URL));

    expect(scan.requestLnurlAuthConfirmation).toHaveBeenCalledWith({
      action: "login",
      domain: "example.com",
      k1: K1,
      requestUrl: LOGIN_URL,
    });
    expect(scan.requestLnurlWithdrawConfirmation).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("leaves a non-login LNURL to the withdraw and pay flows", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tag: "payRequest" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const scan = await setup();

    await scan.handle(encodeLnurl(PAY_URL));

    expect(scan.requestLnurlAuthConfirmation).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
