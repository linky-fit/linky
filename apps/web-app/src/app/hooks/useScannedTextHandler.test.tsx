import {
  encodeNprofile,
  encodeNpub,
  type NostrConnectRequest,
} from "@linky-fit/linkstr";
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
import { useScannedTextHandler } from "./useScannedTextHandler";
import { useCashuPaymentRequestConfirmation } from "./payments/useCashuPaymentRequestConfirmation";
import {
  buildCashuPaymentRequestMessage,
  type CashuPaymentRequestMessageInfo,
} from "../lib/paymentRequestMessage";
import { encodeBase64Url } from "../../utils/base64";

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
  contacts = [],
  currentNpub = null,
  cashuIsBusy = false,
}: {
  autoPayLimit?: number;
  contacts?: ScanParams["contacts"];
  currentNpub?: string | null;
  cashuIsBusy?: boolean;
} = {}) => {
  const requestLnurlAuthConfirmation = vi.fn<(p: LnurlAuthPreview) => void>();
  const requestLnurlWithdrawConfirmation = vi.fn();
  const requestNostrConnectLoginConfirmation =
    vi.fn<(request: NostrConnectRequest) => void>();
  const runCashuPaymentRequest = vi
    .fn<(request: CashuPaymentRequestMessageInfo) => Promise<void>>()
    .mockResolvedValue(undefined);
  const payLightningInvoiceWithCashu = vi
    .fn<(invoice: string) => Promise<boolean>>()
    .mockResolvedValue(true);
  const requestLightningInvoiceConfirmation = vi.fn();
  const handlerRef: { current: ScannedTextHandler | null } = { current: null };
  const confirmationRef: {
    current: ReturnType<typeof useCashuPaymentRequestConfirmation> | null;
  } = { current: null };

  const Probe = (): null => {
    const confirmation = useCashuPaymentRequestConfirmation({
      autoPayLimit,
      currentNpub,
      cashuIsBusy,
      runCashuPaymentRequest,
    });
    const handle = useScannedTextHandler({
      closeScan: () => undefined,
      contacts,
      contactsRepository: { insert: () => Effect.void },
      currentNpub,
      extractCashuTokenFromText: () => null,
      lightningInvoiceAutoPayLimit: autoPayLimit,
      onContactIdentifierScanned: null,
      openScannedContactPendingNpubRef: { current: null },
      payCashuPaymentRequest: confirmation.payCashuPaymentRequest,
      payLightningInvoiceWithCashu,
      requestLightningInvoiceConfirmation,
      requestLnurlAuthConfirmation,
      requestLnurlWithdrawConfirmation,
      requestNostrConnectLoginConfirmation,
      saveCashuFromText: async () => undefined,
      scanAcceptsBankPayment: false,
      scanEntryPoint: null,
      setStatus: () => undefined,
      t: translateToKey,
    });

    React.useEffect(() => {
      handlerRef.current = handle;
      confirmationRef.current = confirmation;
    });
    return null;
  };

  const rendered = await renderIntoDocument(<Probe />);
  unmounts.push(rendered.unmount);

  return {
    handle: async (text: string) => {
      const handle = handlerRef.current;
      if (!handle) throw new Error("scan handler did not mount");
      await act(async () => handle(text));
    },
    get confirmation() {
      const confirmation = confirmationRef.current;
      if (!confirmation) throw new Error("confirmation hook did not mount");
      return confirmation;
    },
    runCashuPaymentRequest,
    payLightningInvoiceWithCashu,
    requestLightningInvoiceConfirmation,
    requestLnurlAuthConfirmation,
    requestLnurlWithdrawConfirmation,
    requestNostrConnectLoginConfirmation,
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

    expect(scan.requestNostrConnectLoginConfirmation).toHaveBeenCalledOnce();
    const request =
      scan.requestNostrConnectLoginConfirmation.mock.calls[0]?.[0];
    expect(request?.clientPubkey).toBe(CLIENT);
    expect(request?.name).toBe("Example");
    expect(request?.url).toBe("https://example.com");
  });

  it("rejects a nostrconnect URI without relays as unsupported", async () => {
    const scan = await setup();

    await scan.handle(`nostrconnect://${CLIENT}?secret=s3cr3t`);

    expect(scan.requestNostrConnectLoginConfirmation).not.toHaveBeenCalled();
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

describe("scanned Cashu auto-pay", () => {
  it.each([999, 1000])(
    "auto-pays %i sats with a 1000-sat limit",
    async (amount) => {
      const scan = await setup({ autoPayLimit: 1000 });
      await scan.handle(cashuRequest(amount));

      expect(scan.runCashuPaymentRequest).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ amount }),
      );
      expect(
        scan.confirmation.pendingCashuPaymentRequestConfirmation,
      ).toBeNull();
    },
  );

  it("requires confirmation above the limit and cancel never pays", async () => {
    const scan = await setup({ autoPayLimit: 1000 });
    await scan.handle(cashuRequest(1001));

    expect(
      scan.confirmation.pendingCashuPaymentRequestConfirmation?.amount,
    ).toBe(1001);
    expect(scan.runCashuPaymentRequest).not.toHaveBeenCalled();
    await act(async () =>
      scan.confirmation.closeCashuPaymentRequestConfirmation(),
    );
    expect(scan.confirmation.pendingCashuPaymentRequestConfirmation).toBeNull();
    await act(async () => scan.confirmation.confirmCashuPaymentRequest());
    expect(scan.runCashuPaymentRequest).not.toHaveBeenCalled();
  });

  it("pays the approved request once and clears the confirmation", async () => {
    const scan = await setup({ autoPayLimit: 1000 });
    await scan.handle(cashuRequest(1001));
    const pending = scan.confirmation.pendingCashuPaymentRequestConfirmation;

    await act(async () => scan.confirmation.confirmCashuPaymentRequest());
    expect(scan.runCashuPaymentRequest).toHaveBeenCalledExactlyOnceWith(
      pending,
    );
    expect(scan.confirmation.pendingCashuPaymentRequestConfirmation).toBeNull();
    await act(async () => scan.confirmation.confirmCashuPaymentRequest());
    expect(scan.runCashuPaymentRequest).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation for positive amounts when the limit is zero", async () => {
    const scan = await setup();
    await scan.handle(cashuRequest(1));

    expect(
      scan.confirmation.pendingCashuPaymentRequestConfirmation?.amount,
    ).toBe(1);
    expect(scan.runCashuPaymentRequest).not.toHaveBeenCalled();
  });

  it.each([500, 1500])(
    "uses the %i-sat Cashu amount in a combined QR",
    async (amount) => {
      const scan = await setup({ autoPayLimit: 1000 });
      await scan.handle(
        `bitcoin:?amount=0.000001&lightning=${lightningInvoice(100)}&creq=${cashuRequest(amount)}`,
      );

      if (amount <= 1000) {
        expect(scan.runCashuPaymentRequest).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ amount }),
        );
        expect(
          scan.confirmation.pendingCashuPaymentRequestConfirmation,
        ).toBeNull();
      } else {
        expect(scan.runCashuPaymentRequest).not.toHaveBeenCalled();
        expect(
          scan.confirmation.pendingCashuPaymentRequestConfirmation?.amount,
        ).toBe(amount);
      }
      expect(scan.payLightningInvoiceWithCashu).not.toHaveBeenCalled();
      expect(scan.requestLightningInvoiceConfirmation).not.toHaveBeenCalled();
    },
  );

  it("keeps self-payments outside the limit because no funds leave", async () => {
    const identity = makeIdentity();
    const scan = await setup({ currentNpub: encodeNpub(identity.pubkey) });
    await scan.handle(
      buildCashuPaymentRequestMessage({
        amount: 2000,
        mintUrls: [],
        recipientNprofile: encodeNprofile(identity.pubkey, []),
      }),
    );

    expect(scan.runCashuPaymentRequest).toHaveBeenCalledOnce();
    expect(scan.confirmation.pendingCashuPaymentRequestConfirmation).toBeNull();
  });

  it.each([500, 1500])(
    "ignores a %i-sat scan while the wallet is busy",
    async (amount) => {
      const scan = await setup({ autoPayLimit: 1000, cashuIsBusy: true });
      await scan.handle(cashuRequest(amount));

      expect(scan.runCashuPaymentRequest).not.toHaveBeenCalled();
      expect(
        scan.confirmation.pendingCashuPaymentRequestConfirmation,
      ).toBeNull();
    },
  );
});

describe("scanned Lightning auto-pay", () => {
  it.each([999, 1000, 1001, null])(
    "keeps the existing policy for %s sats",
    async (amount) => {
      const scan = await setup({ autoPayLimit: 1000 });
      const invoice = lightningInvoice(amount);
      await scan.handle(invoice);

      if (amount !== null && amount <= 1000) {
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
      expect(scan.runCashuPaymentRequest).not.toHaveBeenCalled();
    },
  );
});
