import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import { MintUrl } from "@linky-fit/linkshu";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { CashuPaymentRequestMessageInfo } from "../../lib/paymentRequestMessage";
import type {
  PaymentRequestQuote,
  QuotePaymentRequestOutcome,
} from "../../state/wallet/payments";
import {
  needsPaymentRequestConfirmation,
  useCashuPaymentRequestConfirmation,
  type ReviewedCashuPaymentRequest,
} from "./useCashuPaymentRequestConfirmation";

const request = (amount: number | null): CashuPaymentRequestMessageInfo => ({
  amount,
  description: null,
  encodedRequest: "creqA",
  lockTo: null,
  mintUrls: [],
  mintsAdvisory: false,
  outsideMintFee: 0,
  preferredTransport: "post",
  requestId: null,
  transportNprofile: null,
  transportPostUrl: "https://shop.example/pay",
  transportPubkeyHex: null,
  transportRelays: [],
  unit: "sat",
});

const direct = (amount: number, fee = 0): PaymentRequestQuote => ({
  _tag: "Direct",
  amount,
  fee,
  mint: MintUrl.make("https://mint.example"),
  methodFee: 0,
});

const overLightning = (addsMint: boolean): PaymentRequestQuote => ({
  _tag: "Lightning",
  amount: 100,
  fee: 5,
  sourceMint: MintUrl.make("https://source.example"),
  targetMint: "https://target.example",
  addsMint,
  moveAmount: 101,
});

describe("needsPaymentRequestConfirmation", () => {
  const needs = (
    overrides: Partial<Parameters<typeof needsPaymentRequestConfirmation>[0]>,
  ) =>
    needsPaymentRequestConfirmation({
      autoPayLimit: 100,
      approval: "scan",
      quote: direct(100),
      recipientDiffers: false,
      ...overrides,
    });

  it("holds a scan to the limit over the amount plus fees", () => {
    expect(needs({ quote: direct(100) })).toBe(false);
    expect(needs({ quote: direct(99, 2) })).toBe(true);
  });

  it("lets a tap on a chat request's Pay skip the limit", () => {
    expect(needs({ quote: direct(500), approval: "tap" })).toBe(false);
  });

  it("always reviews a payment marked for review, whatever the limit", () => {
    expect(
      needs({ quote: direct(1), autoPayLimit: 1_000, approval: "review" }),
    ).toBe(true);
  });

  it("always asks for an amount, another recipient or a new mint", () => {
    expect(needs({ quote: null, approval: "tap" })).toBe(true);
    expect(needs({ recipientDiffers: true, approval: "tap" })).toBe(true);
    expect(needs({ quote: overLightning(true), approval: "tap" })).toBe(true);
    expect(needs({ quote: overLightning(false), autoPayLimit: 1_000 })).toBe(
      false,
    );
  });
});

describe("useCashuPaymentRequestConfirmation", () => {
  const unmounts: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const unmount of unmounts.splice(0)) await unmount();
  });

  const setup = async ({
    autoPayLimit = 100,
    cashuIsBusy = false,
    quote = async (_request, amountSat) => direct(amountSat),
  }: {
    autoPayLimit?: number;
    cashuIsBusy?: boolean;
    quote?: (
      request: CashuPaymentRequestMessageInfo,
      amountSat: number,
    ) => Promise<QuotePaymentRequestOutcome | null>;
  } = {}) => {
    const pay = vi
      .fn<(reviewed: ReviewedCashuPaymentRequest) => Promise<void>>()
      .mockResolvedValue(undefined);
    const quoteMock = vi.fn(quote);
    const reportUnpayable = vi.fn();
    const ref: {
      current: ReturnType<typeof useCashuPaymentRequestConfirmation> | null;
    } = { current: null };
    const Probe = (): null => {
      const confirmation = useCashuPaymentRequestConfirmation({
        autoPayLimit,
        cashuIsBusy,
        pay,
        quote: quoteMock,
        reportUnpayable,
      });
      React.useEffect(() => {
        ref.current = confirmation;
      });
      return null;
    };
    const rendered = await renderIntoDocument(
      <RegistryContext.Provider value={AtomRegistry.make()}>
        <Probe />
      </RegistryContext.Provider>,
    );
    unmounts.push(rendered.unmount);
    const current = () => {
      if (!ref.current) throw new Error("hook did not mount");
      return ref.current;
    };
    return {
      current,
      pay,
      quote: quoteMock,
      reportUnpayable,
      review: (amount: number | null, recipientDiffers = false) =>
        act(() =>
          current().reviewCashuPaymentRequest({
            request: request(amount),
            chat: null,
            recipientDiffers,
            approval: "scan",
          }),
        ),
    };
  };

  it("pays a request within the limit without asking", async () => {
    const hook = await setup();
    await hook.review(100);

    expect(hook.pay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ quote: direct(100) }),
    );
    expect(hook.current().pendingCashuPaymentRequestConfirmation).toBeNull();
  });

  it("holds a request over the limit until it is confirmed once", async () => {
    const hook = await setup();
    await hook.review(101);

    expect(hook.pay).not.toHaveBeenCalled();
    expect(
      hook.current().pendingCashuPaymentRequestConfirmation?.quote,
    ).toEqual(direct(101));
    await act(() => hook.current().confirmCashuPaymentRequest());
    await act(() => hook.current().confirmCashuPaymentRequest());

    expect(hook.pay).toHaveBeenCalledOnce();
    expect(hook.current().pendingCashuPaymentRequestConfirmation).toBeNull();
  });

  it("hands the payer's checks through the review, such as whether a transfer is still payable and marking it sent", async () => {
    const hook = await setup();
    const onPaid = vi.fn();
    const isPaymentAuthorized = vi.fn(() => true);
    await act(() =>
      hook.current().reviewCashuPaymentRequest({
        request: request(101),
        chat: null,
        recipientDiffers: false,
        approval: "scan",
        isPaymentAuthorized,
        onPaid,
      }),
    );
    await act(() => hook.current().confirmCashuPaymentRequest());

    expect(hook.pay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ isPaymentAuthorized, onPaid }),
    );
  });

  it("never pays a cancelled request", async () => {
    const hook = await setup();
    await hook.review(101);
    await act(async () =>
      hook.current().closeCashuPaymentRequestConfirmation(),
    );
    await act(() => hook.current().confirmCashuPaymentRequest());

    expect(hook.pay).not.toHaveBeenCalled();
  });

  it("asks for the amount of an amountless request, then prices it", async () => {
    const outcomes: QuotePaymentRequestOutcome[] = [
      { _tag: "Insufficient" },
      direct(40),
    ];
    const hook = await setup({
      quote: async () => outcomes.shift() ?? null,
    });
    await hook.review(null);

    expect(hook.quote).not.toHaveBeenCalled();
    expect(hook.current().pendingCashuPaymentRequestConfirmation).toMatchObject(
      { quote: null, insufficientAmount: null },
    );
    await act(() => hook.current().enterCashuPaymentRequestAmount(500));
    expect(
      hook.current().pendingCashuPaymentRequestConfirmation?.insufficientAmount,
    ).toBe(500);
    await act(() => hook.current().enterCashuPaymentRequestAmount(40));
    expect(hook.quote).toHaveBeenLastCalledWith(request(null), 40);
    expect(
      hook.current().pendingCashuPaymentRequestConfirmation?.quote,
    ).toEqual(direct(40));
    await act(() => hook.current().confirmCashuPaymentRequest());

    expect(hook.pay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ quote: direct(40) }),
    );
  });

  it("asks before paying someone other than the chat's contact", async () => {
    const hook = await setup();
    await hook.review(10, true);

    expect(hook.pay).not.toHaveBeenCalled();
    expect(
      hook.current().pendingCashuPaymentRequestConfirmation?.recipientDiffers,
    ).toBe(true);
  });

  it("reports a request it cannot pay instead of holding it", async () => {
    const hook = await setup({
      quote: async () => ({
        _tag: "NeedsMintMove",
        fromMint: MintUrl.make("https://source.example"),
        toMint: MintUrl.make("https://mint.example"),
      }),
    });
    await hook.review(100);

    expect(hook.reportUnpayable).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ _tag: "NeedsMintMove" }),
    );
    expect(hook.pay).not.toHaveBeenCalled();
    expect(hook.current().pendingCashuPaymentRequestConfirmation).toBeNull();
  });

  it("ignores a request while the wallet is busy", async () => {
    const hook = await setup({ cashuIsBusy: true });
    await hook.review(500);

    expect(hook.quote).not.toHaveBeenCalled();
    expect(hook.current().pendingCashuPaymentRequestConfirmation).toBeNull();
  });
});
