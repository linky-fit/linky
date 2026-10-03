import {
  Amount,
  Bolt11Invoice,
  MintUnreachable,
  MintUrl,
  QuoteId,
  OperationId,
  TokenText,
  TopupQuote,
  TopupReceipt,
} from "@linky-fit/linkshu";
import { Either } from "effect";
import { nip19 } from "nostr-tools";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { Route } from "../../../types/route";
import type {
  CashuTopupHandle,
  ResumePendingCashuTopups,
  StartCashuTopup,
} from "../composition/useLinkshuComposition";

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }));

vi.mock("../../../hooks/useRouting", () => ({
  navigateTo: navigateToMock,
}));

import { parseCashuPaymentRequestMessage } from "../../lib/paymentRequestMessage";
import { useTopupFlow } from "./useTopupFlow";

const MINT_URL = "https://mint.example";
const INVOICE = "lnbc2100n1pfakeinvoice";
// parseCashuPaymentRequestMessage checks the pubkey is on-curve, so this is
// getPublicKey of the all-ones secret key.
const RECIPIENT_NPROFILE = nip19.nprofileEncode({
  pubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
  relays: ["wss://relay.example"],
});

const topupQuote = (quoteId = "quote-1"): TopupQuote =>
  new TopupQuote({
    quoteId: QuoteId.make(quoteId),
    mint: MintUrl.make(MINT_URL),
    amount: Amount.make(21),
    invoice: Bolt11Invoice.make(INVOICE),
    expiresAt: null,
    locked: false,
  });

const topupReceipt = (quote: TopupQuote): TopupReceipt =>
  new TopupReceipt({
    operationId: OperationId.make("op-1"),
    tokenText: TokenText.make("cashuBfaketoken"),
    mint: quote.mint,
    amount: quote.amount,
    quoteId: quote.quoteId,
  });

interface Deferred {
  handle: CashuTopupHandle;
  settle: (result: Awaited<CashuTopupHandle["completion"]>) => Promise<void>;
}

const deferredHandle = (quote: TopupQuote): Deferred => {
  let resolve: (result: Awaited<CashuTopupHandle["completion"]>) => void;
  const completion = new Promise<Awaited<CashuTopupHandle["completion"]>>(
    (res) => {
      resolve = res;
    },
  );
  return {
    handle: { quote, completion },
    settle: async (result) => {
      await act(async () => {
        resolve(result);
        await completion;
      });
    },
  };
};

type Flow = ReturnType<typeof useTopupFlow>;

interface SetupOptions {
  resumePendingCashuTopups?: ResumePendingCashuTopups;
  routeKind?: Route["kind"];
  startCashuTopup?: StartCashuTopup;
  topupRecipientNprofile?: string | null;
}

const setup = async ({
  resumePendingCashuTopups,
  routeKind = "topupInvoice",
  startCashuTopup,
  topupRecipientNprofile = null,
}: SetupOptions) => {
  const flowRef: { current: Flow | null } = { current: null };
  const setRouteKindRef: {
    current: (kind: Route["kind"]) => void;
  } = { current: () => {} };
  const logPaymentEvent = vi.fn();
  const showPaidOverlay = vi.fn();

  const Harness = () => {
    const [currentRouteKind, setCurrentRouteKind] = React.useState(routeKind);
    const topupPaidNavTimerRef = React.useRef<number | null>(null);
    const flow = useTopupFlow({
      cashuTotalBalance: 0,
      defaultMintUrl: MINT_URL,
      formatDisplayedAmountParts: (amountSat) => ({
        approxPrefix: "",
        amountText: String(amountSat),
        unitLabel: "sat",
      }),
      logPaymentEvent,
      resumePendingCashuTopups: resumePendingCashuTopups ?? null,
      routeKind: currentRouteKind,
      showPaidOverlay,
      startCashuTopup: startCashuTopup ?? null,
      t: (key) => key,
      topupPaidNavTimerRef,
      topupRecipientNprofile,
    });
    React.useEffect(() => {
      flowRef.current = flow;
      setRouteKindRef.current = setCurrentRouteKind;
    }, [flow]);
    return null;
  };

  const { unmount } = await renderIntoDocument(<Harness />);
  const flow = () => {
    if (flowRef.current === null) throw new Error("flow hook did not mount");
    return flowRef.current;
  };
  return {
    flow,
    logPaymentEvent,
    setRouteKind: async (kind: Route["kind"]) => {
      await act(async () => {
        setRouteKindRef.current(kind);
      });
    },
    showPaidOverlay,
    unmount,
  };
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// State settles over chained promises (start -> render -> QR render), so
// poll the assertion instead of racing it with a fixed number of flushes.
const waitFor = async (assertion: () => void): Promise<void> => {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await act(async () => {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 10);
        });
      });
    }
  }
};

describe("useTopupFlow", () => {
  it("starts a topup on the invoice route and finalizes on completion", async () => {
    const quote = topupQuote();
    const deferred = deferredHandle(quote);
    const start = vi.fn<StartCashuTopup>(async () =>
      Either.right(deferred.handle),
    );
    const harness = await setup({ startCashuTopup: start });

    await act(async () => {
      harness.flow().setTopupAmount("21");
    });

    expect(start).toHaveBeenCalledWith({ amountSat: 21, mint: MINT_URL });
    await waitFor(() => {
      expect(harness.flow().topupInvoice).toBe(INVOICE);
      expect(harness.flow().topupMintUrl).toBe(MINT_URL);
      expect(harness.flow().topupInvoiceQrPayload).toBe(INVOICE);
    });

    await deferred.settle(Either.right(topupReceipt(quote)));

    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 21,
        direction: "in",
        method: "lightning_invoice",
        mint: MINT_URL,
        status: "ok",
      }),
    );
    expect(harness.showPaidOverlay).toHaveBeenCalledWith(
      "topupOverlay",
      expect.objectContaining({ direction: "in" }),
    );
    expect(harness.flow().topupInvoice).toBeNull();
    expect(harness.flow().topupAmount).toBe("");
    // The finalized quote never restarts even though the route is unchanged.
    expect(start).toHaveBeenCalledTimes(1);
    await harness.unmount();
  });

  it("keeps the quote id out of the cashu request in the QR", async () => {
    // An unlocked quote is mintable by its id alone (NUT-04), so the QR and
    // copied payload must not carry it.
    const quote = topupQuote();
    const harness = await setup({
      startCashuTopup: vi.fn<StartCashuTopup>(async () =>
        Either.right(deferredHandle(quote).handle),
      ),
      topupRecipientNprofile: RECIPIENT_NPROFILE,
    });

    await act(async () => {
      harness.flow().setTopupAmount("21");
    });

    await waitFor(() => {
      expect(harness.flow().topupInvoiceCashuRequest).not.toBeNull();
    });
    const request = harness.flow().topupInvoiceCashuRequest ?? "";
    expect(parseCashuPaymentRequestMessage(request)?.requestId).toBeNull();
    expect(request).not.toContain(quote.quoteId);
    expect(harness.flow().topupInvoiceQrPayload).not.toContain(quote.quoteId);
    await harness.unmount();
  });

  it("asks the mint for the note as invoice description and records it", async () => {
    const quote = topupQuote();
    const deferred = deferredHandle(quote);
    const start = vi.fn<StartCashuTopup>(async () =>
      Either.right(deferred.handle),
    );
    const harness = await setup({ startCashuTopup: start });

    await act(async () => {
      harness.flow().setTopupNote(" rent ");
      harness.flow().setTopupAmount("21");
    });

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        amountSat: 21,
        description: "rent",
        mint: MINT_URL,
      });
    });

    await deferred.settle(Either.right(topupReceipt(quote)));

    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ note: "rent", status: "ok" }),
    );
    expect(harness.flow().topupNote).toBe("");
    await harness.unmount();
  });

  it("does not start twice for one amount and mint", async () => {
    const deferred = deferredHandle(topupQuote());
    const start = vi.fn<StartCashuTopup>(async () =>
      Either.right(deferred.handle),
    );
    const harness = await setup({ startCashuTopup: start });

    await act(async () => {
      harness.flow().setTopupAmount("21");
    });
    await waitFor(() => {
      expect(harness.flow().topupInvoice).toBe(INVOICE);
    });
    await harness.setRouteKind("topup");
    await harness.setRouteKind("topupInvoice");

    expect(start).toHaveBeenCalledTimes(1);
    expect(harness.flow().topupInvoice).toBe(INVOICE);
    await harness.unmount();
  });

  it("shows the typed error when the quote cannot be created", async () => {
    const start = vi.fn<StartCashuTopup>(async () =>
      Either.left(
        new MintUnreachable({ mint: MintUrl.make(MINT_URL), detail: "down" }),
      ),
    );
    const harness = await setup({ startCashuTopup: start });

    await act(async () => {
      harness.flow().setTopupAmount("21");
    });

    await waitFor(() => {
      expect(harness.flow().topupInvoice).toBeNull();
      expect(harness.flow().topupInvoiceError).toBe(
        "topupInvoiceFailed: Mint unreachable: down",
      );
    });
    await harness.unmount();
  });

  it("resumes pending topups at launch and finalizes them in the background", async () => {
    const quote = topupQuote("quote-resumed");
    const deferred = deferredHandle(quote);
    const resume = vi.fn<ResumePendingCashuTopups>(async () => [
      deferred.handle,
    ]);
    const harness = await setup({
      resumePendingCashuTopups: resume,
      routeKind: "wallet",
    });

    expect(resume).toHaveBeenCalledTimes(1);

    await deferred.settle(Either.right(topupReceipt(quote)));

    expect(harness.showPaidOverlay).toHaveBeenCalledWith(
      "topupOverlay",
      expect.objectContaining({ direction: "in" }),
    );
    expect(harness.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 21, direction: "in", status: "ok" }),
    );
    expect(harness.flow().topupInvoice).toBeNull();
    await harness.unmount();
  });
});

describe("useTopupFlow paid navigation timer", () => {
  const settleTopupOnInvoiceRoute = async () => {
    vi.useFakeTimers();
    const quote = topupQuote();
    const deferred = deferredHandle(quote);
    const harness = await setup({
      startCashuTopup: vi.fn<StartCashuTopup>(async () =>
        Either.right(deferred.handle),
      ),
    });
    await act(async () => {
      harness.flow().setTopupAmount("21");
    });
    await deferred.settle(Either.right(topupReceipt(quote)));
    return harness;
  };

  it("navigates to the wallet when the user stays on the invoice page", async () => {
    const harness = await settleTopupOnInvoiceRoute();

    await act(async () => {
      vi.advanceTimersByTime(1400);
    });

    expect(navigateToMock).toHaveBeenCalledWith({ route: "wallet" });
    await harness.unmount();
  });

  it("does not stomp a navigation made during the celebration delay", async () => {
    const harness = await settleTopupOnInvoiceRoute();

    await harness.setRouteKind("contacts");
    await act(async () => {
      vi.advanceTimersByTime(1400);
    });

    expect(navigateToMock).not.toHaveBeenCalled();
    await harness.unmount();
  });
});
