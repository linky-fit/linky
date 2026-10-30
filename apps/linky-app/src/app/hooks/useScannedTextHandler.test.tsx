import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { encodeNpub } from "@linky-fit/linkstr";
import { createId } from "@linky-fit/linksync";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { encode } from "cbor-x";
import { bech32 } from "@scure/base";
import { Effect } from "effect";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import type { LnurlAuthPreview } from "../../lnurlAuth";
import type { Translate } from "../../i18n";
import type { SiteLoginRequest } from "../../siteLogin";
import { useScannedTextHandler } from "./useScannedTextHandler";
import type { CashuPaymentRequestMessageInfo } from "../lib/paymentRequestMessage";
import { encodeBase64Url } from "../../utils/base64";
import { optimizeCaseInsensitiveQrPayload } from "../../utils/qrPayload";
import {
  CALLBACK_URL,
  linkauthFragment,
} from "../../testUtils/siteLoginFixtures";
import { isKeryxJoinUrl, takeKeryxJoinOffer } from "../lib/keryxJoinOffer";

const K1 = "b".repeat(64);
const LOGIN_URL = `https://example.com/lnurl-auth?tag=login&k1=${K1}&action=login`;
const PAY_URL = "https://example.com/lnurlp/alice";

const encodeLnurl = (url: string): string => {
  const bytes = new TextEncoder().encode(url);
  return bech32.encode("lnurl", bech32.toWords(bytes), 2000).toUpperCase();
};

type ScannedTextHandler = ReturnType<typeof useScannedTextHandler>;

const unmounts: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of unmounts.splice(0)) await unmount();
  vi.restoreAllMocks();
});

const translateToKey: Translate = (key) => key;

type ScanParams = Parameters<typeof useScannedTextHandler>[0];

const setup = async ({
  autoPayLimit = 0,
  canPayFromHeldMint = true,
  contacts = [],
  currentNpub = null,
  keryxEnabled = true,
  onchainSendEnabled = true,
  scanEntryPoint = null,
}: {
  autoPayLimit?: number;
  canPayFromHeldMint?: boolean;
  contacts?: ScanParams["contacts"];
  currentNpub?: string | null;
  keryxEnabled?: boolean;
  onchainSendEnabled?: boolean;
  scanEntryPoint?: ScanParams["scanEntryPoint"];
} = {}) => {
  const requestLnurlAuthConfirmation = vi.fn<(p: LnurlAuthPreview) => void>();
  const requestLnurlWithdrawConfirmation = vi.fn();
  const requestSiteLoginConfirmation = vi
    .fn<(login: SiteLoginRequest) => Promise<void>>()
    .mockResolvedValue(undefined);
  const requestLinkauthLogin = vi
    .fn<(link: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const payCashuPaymentRequest = vi
    .fn<(request: CashuPaymentRequestMessageInfo) => Promise<void>>()
    .mockResolvedValue(undefined);
  const canPayCashuRequest = vi
    .fn<(request: CashuPaymentRequestMessageInfo) => boolean>()
    .mockReturnValue(canPayFromHeldMint);
  const payLightningInvoiceWithCashu = vi
    .fn<(invoice: string) => Promise<boolean>>()
    .mockResolvedValue(true);
  const requestLightningInvoiceConfirmation = vi.fn();
  const insertContact = vi.fn<ScanParams["contactsRepository"]["insert"]>(
    () => Effect.void,
  );
  const setStatus = vi.fn<ScanParams["setStatus"]>();
  const handlerRef: { current: ScannedTextHandler | null } = { current: null };

  const Probe = (): null => {
    const handle = useScannedTextHandler({
      canPayCashuRequest,
      closeScan: () => undefined,
      contacts,
      contactsRepository: { insert: insertContact },
      currentNpub,
      extractCashuTokenFromText: () => null,
      keryxEnabled,
      lightningInvoiceAutoPayLimit: autoPayLimit,
      onchainSendEnabled,
      onContactIdentifierScanned: null,
      openSavedContact: () => {},
      payCashuPaymentRequest,
      payLightningInvoiceWithCashu,
      requestLightningInvoiceConfirmation,
      requestLnurlAuthConfirmation,
      requestLnurlWithdrawConfirmation,
      requestLinkauthLogin,
      requestSiteLoginConfirmation,
      saveCashuFromText: async () => undefined,
      scanAcceptsBankPayment: false,
      scanEntryPoint,
      setStatus,
      t: translateToKey,
    });

    React.useEffect(() => {
      handlerRef.current = handle;
    });
    return null;
  };

  const rendered = await renderIntoDocument(
    <RegistryContext.Provider value={AtomRegistry.make()}>
      <Probe />
    </RegistryContext.Provider>,
  );
  unmounts.push(rendered.unmount);

  return {
    handle: async (text: string) => {
      const handle = handlerRef.current;
      if (!handle) throw new Error("scan handler did not mount");
      await act(async () => handle(text));
    },
    insertContact,
    setStatus,
    canPayCashuRequest,
    payCashuPaymentRequest,
    payLightningInvoiceWithCashu,
    requestLightningInvoiceConfirmation,
    requestLnurlAuthConfirmation,
    requestLnurlWithdrawConfirmation,
    requestLinkauthLogin,
    requestSiteLoginConfirmation,
  };
};

const lightningInvoice = (amount: number | null) =>
  bech32.encode(
    amount === null ? "lnbc" : `lnbc${amount * 10}n`,
    new Array<number>(111).fill(0),
    5000,
  );

const cashuRequest = (amount: number) =>
  `creqA${encodeBase64Url(
    encode({
      a: amount,
      u: "sat",
      t: [{ t: "post", a: "https://pay.example/request" }],
    }),
  )}`;

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

describe("scanned Nostr Connect logins", () => {
  const CLIENT = makeIdentity().pubkey;
  const NOSTR_CONNECT_URI = `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Frelay.example.com&secret=s3cr3t&name=Example&url=https%3A%2F%2Fexample.com`;

  it.each([
    ["scanned", NOSTR_CONNECT_URI],
    ["pasted with whitespace", `  ${NOSTR_CONNECT_URI}\n`],
  ])("asks to log in for a %s nostrconnect URI", async (_, text) => {
    const scan = await setup();

    await scan.handle(text);

    expect(scan.requestSiteLoginConfirmation).toHaveBeenCalledOnce();
    expect(scan.requestSiteLoginConfirmation.mock.calls[0]?.[0]).toMatchObject({
      channel: "relay",
      request: {
        clientPubkey: CLIENT,
        name: "Example",
        url: "https://example.com",
      },
    });
  });

  const LINKAUTH_FRAGMENT = linkauthFragment({ cb: CALLBACK_URL });

  it.each([
    ["a pasted web link", `https://app.linky.fit/#${LINKAUTH_FRAGMENT}`],
    ["a stored hash fragment", LINKAUTH_FRAGMENT],
    ["a cross-device link", `https://app.linky.fit/#${linkauthFragment()}`],
    [
      "a link with an unusable callback",
      `https://app.linky.fit/#${linkauthFragment({ cb: "http://shop.example" })}`,
    ],
  ])("hands %s to the linkauth resolution untouched", async (_, text) => {
    const scan = await setup();

    await scan.handle(text);

    expect(scan.requestLinkauthLogin).toHaveBeenCalledExactlyOnceWith(text);
    expect(scan.requestSiteLoginConfirmation).not.toHaveBeenCalled();
  });

  it("rejects a nostrconnect URI without relays as unsupported", async () => {
    const scan = await setup();

    await scan.handle(`nostrconnect://${CLIENT}?secret=s3cr3t`);

    expect(scan.requestSiteLoginConfirmation).not.toHaveBeenCalled();
  });
});

describe("scanned Keryx join URLs", () => {
  it("hands the join URL to Add company without putting it in the route", async () => {
    const scan = await setup();
    const join = "https://acme.example/join?p=eyJ2IjoxfQ";

    await scan.handle(join);

    expect(window.location.hash).toBe("#settings/keryx/new");
    expect(takeKeryxJoinOffer()).toBe(join);
  });

  it("ignores join URLs while experimental features are off", async () => {
    window.location.hash = "#contacts";
    const scan = await setup({ keryxEnabled: false });

    await scan.handle("https://acme.example/join?p=eyJ2IjoxfQ");

    expect(window.location.hash).toBe("#contacts");
    expect(takeKeryxJoinOffer()).toBeNull();
  });

  it("leaves other HTTPS URLs to the LNURL flows", () => {
    expect(isKeryxJoinUrl(PAY_URL)).toBe(false);
    expect(isKeryxJoinUrl("https://acme.example/join/")).toBe(true);
    expect(isKeryxJoinUrl("http://acme.example/join")).toBe(false);
  });
});

describe("scanned Profile QR with an uppercase npub", () => {
  const npub = encodeNpub(makeIdentity().pubkey);
  const qrPayload = optimizeCaseInsensitiveQrPayload(npub);

  it("recognises the user's own QR", async () => {
    const scan = await setup({ currentNpub: npub });
    await scan.handle(qrPayload);

    expect(scan.setStatus).toHaveBeenCalledWith("contactIsYou");
    expect(scan.insertContact).not.toHaveBeenCalled();
  });

  it("opens the existing contact instead of duplicating it", async () => {
    const id = createId<"Contact">();
    const scan = await setup({ contacts: [{ id, name: "Bob", npub }] });
    await scan.handle(qrPayload);

    expect(scan.setStatus).toHaveBeenCalledWith("contactExists");
    expect(scan.insertContact).not.toHaveBeenCalled();
  });

  it("saves a new contact with the lowercase npub", async () => {
    const scan = await setup();
    await scan.handle(qrPayload);

    expect(scan.insertContact).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ npub }),
    );
  });
});

describe("scanned lightning addresses", () => {
  it("opens the address pay screen even when a contact has the address", async () => {
    const scan = await setup({
      contacts: [
        {
          id: createId<"Contact">(),
          name: "Alice",
          npub: encodeNpub(makeIdentity().pubkey),
          lnAddress: "alice@linky.fit",
        },
      ],
    });

    await scan.handle("alice@linky.fit");

    expect(window.location.hash).toBe("#payln/alice%40linky.fit");
  });
});

describe("scanned Cashu requests", () => {
  it("hands a scanned request to the payment flow", async () => {
    const scan = await setup();
    await scan.handle(cashuRequest(1001));

    expect(scan.payCashuPaymentRequest).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ amount: 1001 }),
    );
  });

  it("pays a combined QR's Cashu leg when a held mint covers it", async () => {
    const scan = await setup({ autoPayLimit: 1000 });
    await scan.handle(
      `bitcoin:?amount=0.000001&lightning=${lightningInvoice(100)}&creq=${cashuRequest(500)}`,
    );

    expect(scan.canPayCashuRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500 }),
    );
    expect(scan.payCashuPaymentRequest).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ amount: 500 }),
    );
    expect(scan.payLightningInvoiceWithCashu).not.toHaveBeenCalled();
  });

  it("pays a combined QR's invoice when no held mint covers the Cashu leg", async () => {
    const scan = await setup({ autoPayLimit: 1000, canPayFromHeldMint: false });
    const invoice = lightningInvoice(100);
    await scan.handle(
      `bitcoin:?amount=0.000001&lightning=${invoice}&creq=${cashuRequest(500)}`,
    );

    expect(scan.payLightningInvoiceWithCashu).toHaveBeenCalledExactlyOnceWith(
      invoice,
    );
    expect(scan.payCashuPaymentRequest).not.toHaveBeenCalled();
  });

  it("falls back to a Cashu leg no held mint covers when it is the only one", async () => {
    const scan = await setup({ canPayFromHeldMint: false });
    await scan.handle(`bitcoin:?creq=${cashuRequest(500)}`);

    expect(scan.payCashuPaymentRequest).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ amount: 500 }),
    );
  });
});

describe("scanned bitcoin addresses", () => {
  const ADDRESS = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";

  it.each([
    [ADDRESS, `#wallet/onchain/send?address=${ADDRESS}`],
    [
      `bitcoin:${ADDRESS}?amount=0.001`,
      `#wallet/onchain/send?address=${ADDRESS}&amount=100000`,
    ],
  ])("opens the on-chain send for %s", async (text, hash) => {
    window.location.hash = "#wallet";
    const scan = await setup({ scanEntryPoint: "send" });
    await scan.handle(text);

    expect(window.location.hash).toBe(hash);
  });

  it("pays a BIP21 URI's Lightning leg rather than its address", async () => {
    const scan = await setup({ autoPayLimit: 1000 });
    const invoice = lightningInvoice(500);
    await scan.handle(`bitcoin:${ADDRESS}?lightning=${invoice}`);

    expect(scan.payLightningInvoiceWithCashu).toHaveBeenCalledWith(invoice);
  });

  it("keeps an address unsupported while on-chain transfers are hidden", async () => {
    window.location.hash = "#wallet";
    const scan = await setup({ onchainSendEnabled: false });
    await scan.handle(`bitcoin:${ADDRESS}`);

    expect(scan.setStatus).toHaveBeenCalledWith("scanUnsupportedBitcoinUri");
    expect(window.location.hash).toBe("#wallet");
  });

  it("does not pay out from the receive scanner", async () => {
    window.location.hash = "#wallet/topup";
    const scan = await setup({ scanEntryPoint: "receive" });
    await scan.handle(ADDRESS);

    expect(scan.setStatus).toHaveBeenCalledWith(
      "scanReceiveUnsupportedPayment",
    );
    expect(window.location.hash).toBe("#wallet/topup");
  });
});

describe("scanned Lightning auto-pay", () => {
  it.each([999, 1000, 1001, null])(
    "keeps the existing policy for %s sats",
    async (amount) => {
      const scan = await setup({ autoPayLimit: 1000 });
      const invoice = lightningInvoice(amount);
      await scan.handle(invoice);

      if (amount === null) {
        expect(scan.payLightningInvoiceWithCashu).not.toHaveBeenCalled();
        expect(scan.requestLightningInvoiceConfirmation).not.toHaveBeenCalled();
        expect(window.location.hash).toBe(
          `#payinvoice/${encodeURIComponent(invoice)}`,
        );
      } else if (amount <= 1000) {
        expect(
          scan.payLightningInvoiceWithCashu,
        ).toHaveBeenCalledExactlyOnceWith(invoice);
        expect(scan.requestLightningInvoiceConfirmation).not.toHaveBeenCalled();
      } else {
        expect(scan.payLightningInvoiceWithCashu).not.toHaveBeenCalled();
        expect(
          scan.requestLightningInvoiceConfirmation,
        ).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ invoice, amountSat: amount }),
        );
      }
      expect(scan.payCashuPaymentRequest).not.toHaveBeenCalled();
    },
  );
});
