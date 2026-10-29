import { MintUrl } from "@linky-fit/linkshu";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LightningInvoiceQuoteState } from "../app/state/shell/confirmations";
import type { I18nKey } from "../i18n";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { LightningInvoiceConfirmModal } from "./LightningInvoiceConfirmModal";

const templates: Partial<Record<I18nKey, string>> = {
  mintMoveEstimateFailed: "fee estimate failed",
  payFeeEstimating: "estimating the fee",
  paymentRequestFees: "fees up to {fee}",
  paymentRequestMaxTotal: "at most {total}",
};
const t = (key: I18nKey) => templates[key] ?? key;

vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock({
    t: (key) => t(key),
  }),
);

const confirmation = {
  invoice: "lnbc-mock",
  amountSat: 5_000,
  description: "Lunch",
  expiresAtSec: null,
};

const render = async (quote: LightningInvoiceQuoteState["outcome"] | null) => {
  const rendered = await renderIntoDocument(
    <LightningInvoiceConfirmModal
      cashuBalance={21_000}
      cashuIsBusy={false}
      confirmation={confirmation}
      onClose={vi.fn()}
      onConfirm={vi.fn(async () => {})}
      quote={quote}
      t={t}
    />,
  );
  const dialogText = () =>
    document.querySelector('[role="dialog"]')?.textContent ?? "";
  return { ...rendered, dialogText };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("LightningInvoiceConfirmModal", () => {
  it("shows the fee and the total as maximums once the invoice is priced", async () => {
    const view = await render({
      _tag: "Quoted",
      amount: 5_000,
      fee: 52,
      mint: MintUrl.make("https://mint.example"),
    });
    expect(view.dialogText()).toContain("fees up to 52 sat");
    expect(view.dialogText()).toContain("at most 5052 sat");
    await view.unmount();
  });

  it("says the fee is being estimated, and when the estimate failed", async () => {
    const pending = await render("pending");
    expect(pending.dialogText()).toContain("estimating the fee");
    await pending.unmount();

    const failed = await render({ _tag: "NetworkError" });
    expect(failed.dialogText()).toContain("fee estimate failed");
    expect(failed.dialogText()).not.toContain("fees up to");
    await failed.unmount();
  });
});
