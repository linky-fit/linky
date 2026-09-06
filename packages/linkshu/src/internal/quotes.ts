import type { MintQuoteBolt11Response } from "@cashu/cashu-ts";
import { Effect, Option, Schema } from "effect";
import { MintRejected } from "../domain/errors";
import { Bolt11Invoice, QuoteId, UnixSeconds } from "../domain/primitives";
import type { MintUrl } from "../domain/primitives";
import { QuoteStateChanged } from "../inspector/events";
import type { InspectorService } from "../inspector/Inspector";

export const decodeQuoteId = Schema.decodeUnknownOption(QuoteId);
export const decodeInvoice = Schema.decodeUnknownOption(Bolt11Invoice);
const decodeExpiry = Schema.decodeUnknownOption(UnixSeconds);

export interface DecodedMintQuote {
  readonly quoteId: QuoteId;
  readonly invoice: Bolt11Invoice;
  /** Mint-stated quote expiry; null when the mint sets none. */
  readonly expiresAt: UnixSeconds | null;
  readonly state: string;
}

/** A mint quote the flows can act on: it must carry an id and an invoice. */
export const decodeMintQuote = (
  mint: MintUrl,
  raw: MintQuoteBolt11Response,
): Effect.Effect<DecodedMintQuote, MintRejected> => {
  const quoteId = decodeQuoteId(raw.quote);
  const invoice = decodeInvoice(raw.request);
  if (Option.isNone(quoteId) || Option.isNone(invoice)) {
    return Effect.fail(
      new MintRejected({
        mint,
        code: null,
        detail: "mint returned a mint quote without a usable invoice",
      }),
    );
  }
  return Effect.succeed({
    quoteId: quoteId.value,
    invoice: invoice.value,
    expiresAt: Option.getOrNull(decodeExpiry(raw.expiry)),
    state: raw.state,
  });
};

export const emitQuoteState = (
  inspector: InspectorService,
  flow: QuoteStateChanged["flow"],
  quote: { readonly quoteId: QuoteId; readonly mint: MintUrl },
  state: string,
): void => {
  inspector.emit(
    () =>
      new QuoteStateChanged(
        { flow, quoteId: quote.quoteId, mint: quote.mint, state },
        { disableValidation: true },
      ),
  );
};
