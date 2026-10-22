import { MintUrl } from "@linky-fit/linkshu";
import { encodeNpub, Pubkey } from "@linky-fit/linkstr";
import { getPublicKey } from "nostr-tools";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CashuPaymentRequestMessageInfo } from "../app/lib/paymentRequestMessage";
import type { PendingCashuPaymentRequest } from "../app/state/shell/confirmations";
import type { PaymentRequestQuote } from "../app/state/wallet/payments";
import type { I18nKey } from "../i18n";
import { createSecretKey } from "../testUtils/nostrKeys";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { formatShortNpub } from "../utils/formatting";
import { CashuPaymentRequestConfirmModal } from "./CashuPaymentRequestConfirmModal";

const templates: Partial<Record<I18nKey, string>> = {
  paymentRequestAddMint: "add {mint}?",
  paymentRequestConfirmRecipient: "to {recipient}",
  paymentRequestFees: "fees up to {fee}",
  paymentRequestMaxTotal: "at most {total}",
  paymentRequestOtherRecipient: "other {recipient}",
};
const t = (key: I18nKey) => templates[key] ?? key;

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    ...(await import("../testUtils/onchainTransfers")).EUR_DISPLAY,
    t: (key) => t(key),
  }),
);

const payee = Pubkey.make(getPublicKey(createSecretKey(3)));

const request: CashuPaymentRequestMessageInfo = {
  amount: 100_000,
  description: "coffee",
  encodedRequest: "creqA",
  lockTo: null,
  mintUrls: ["https://target.example"],
  mintsAdvisory: false,
  outsideMintFee: 0,
  preferredTransport: "nostr",
  requestId: null,
  transportNprofile: "nprofile",
  transportPostUrl: null,
  transportPubkeyHex: payee,
  transportRelays: [],
  unit: "sat",
};

const pending = (
  quote: PaymentRequestQuote | null,
  overrides: Partial<PendingCashuPaymentRequest> = {},
): PendingCashuPaymentRequest => ({
  request,
  quote,
  chat: null,
  recipientDiffers: false,
  insufficientAmount: null,
  ...overrides,
});

const render = async (confirmation: PendingCashuPaymentRequest) => {
  const onConfirm = vi.fn(async () => {});
  const onEnterAmount = vi.fn<(amountSat: number) => Promise<void>>(
    async () => {},
  );
  const rendered = await renderIntoDocument(
    <CashuPaymentRequestConfirmModal
      cashuIsBusy={false}
      confirmation={confirmation}
      onClose={vi.fn()}
      onConfirm={onConfirm}
      onEnterAmount={onEnterAmount}
      t={t}
    />,
  );
  const dialogText = () =>
    document.querySelector('[role="dialog"]')?.textContent ?? "";
  const button = (label: string) => {
    const found = [...document.querySelectorAll("button")].find(
      (element) => element.textContent === label,
    );
    if (!found) throw new Error(`no ${label} button`);
    return found;
  };
  return { ...rendered, button, dialogText, onConfirm, onEnterAmount };
};

const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CashuPaymentRequestConfirmModal", () => {
  it("shows the exact amount, the fees and the total as maximums, and pays on confirm", async () => {
    const view = await render(
      pending({
        _tag: "Direct",
        amount: 100_000,
        fee: 4,
        mint: MintUrl.make("https://target.example"),
        methodFee: 0,
      }),
    );

    expect(view.dialogText()).toContain("100,000sat~100 EUR");
    expect(view.dialogText()).toContain("fees up to 4 sat (~0 EUR)");
    expect(view.dialogText()).toContain("at most 100,004 sat (~100 EUR)");
    expect(view.dialogText()).toContain(
      `to ${formatShortNpub(encodeNpub(payee))}`,
    );
    expect(view.dialogText()).not.toContain("add ");
    await act(async () => view.button("paySend").click());
    expect(view.onConfirm).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("shows the Lightning fee reserve and asks before adding the target mint", async () => {
    const view = await render(
      pending({
        _tag: "Lightning",
        amount: 100_000,
        fee: 5_056,
        sourceMint: MintUrl.make("https://source.example"),
        targetMint: "https://target.example",
        addsMint: true,
        moveAmount: 100_100,
      }),
    );

    expect(view.dialogText()).toContain("fees up to 5,056 sat (~5 EUR)");
    expect(view.dialogText()).toContain("at most 105,056 sat (~105 EUR)");
    expect(view.dialogText()).toContain("add target.example?");
    await view.unmount();
  });

  it("names the payee and says what the payment does when the caller knows", async () => {
    const view = await render(
      pending(
        {
          _tag: "Direct",
          amount: 100_000,
          fee: 0,
          mint: MintUrl.make("https://target.example"),
          methodFee: 0,
        },
        { recipientName: "Linky support", summary: "Send 99 sat to bc1q" },
      ),
    );

    expect(view.dialogText()).toContain("to Linky support");
    expect(view.dialogText()).toContain("Send 99 sat to bc1q");
    expect(view.dialogText()).not.toContain("coffee");
    expect(view.dialogText()).not.toContain("fees up to");
    await view.unmount();
  });

  it("names the recipient when it is not the chat's contact", async () => {
    const view = await render(
      pending(
        {
          _tag: "Direct",
          amount: 100_000,
          fee: 0,
          mint: MintUrl.make("https://target.example"),
          methodFee: 0,
        },
        { recipientDiffers: true },
      ),
    );

    expect(view.dialogText()).toContain(
      `other ${formatShortNpub(encodeNpub(payee))}`,
    );
    await view.unmount();
  });

  it("takes the amount of an amountless request and refuses one no mint covers", async () => {
    const view = await render(
      pending(null, {
        request: { ...request, amount: null },
        insufficientAmount: 500,
      }),
    );
    const input = document.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error("no input");

    expect(view.dialogText()).toContain("paymentRequestEnterAmount");
    await typeInto(input, "500");
    expect(view.dialogText()).toContain("payInsufficient");
    await typeInto(input, "21");
    await act(async () => view.button("continue").click());
    expect(view.onEnterAmount).toHaveBeenCalledExactlyOnceWith(21);
    await view.unmount();
  });
});
