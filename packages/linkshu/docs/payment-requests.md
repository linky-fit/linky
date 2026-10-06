# Payment requests

Helpers for asking to be paid: NUT-18 `creqA…` payment requests and BIP-321 `bitcoin:` URIs that offer a Lightning invoice and a Cashu request side by side. They are pure functions with no wallet runtime, also exported without cashu-ts from `@linky-fit/linkshu/payment-request`.

## Building a request

`encodeNostrPaymentRequest` builds a single-use `sat` request payable at the given mints, whose payer sends the token as a NIP-17 message to an nprofile. `buildBip321PaymentUri` puts it next to a bolt11 invoice as `bitcoin:?lightning=<bolt11>&creq=<creqA…>`; a wallet pays whichever leg it understands.

```ts
import {
  buildBip321PaymentUri,
  encodeNostrPaymentRequest,
} from "@linky-fit/linkshu/payment-request";

const paymentUri = (args: {
  amountSat: number;
  mintUrl: string;
  invoice: string;
  deviceNprofile: string;
  paymentId: string;
}) =>
  buildBip321PaymentUri({
    lightning: args.invoice,
    creq: encodeNostrPaymentRequest({
      amount: args.amountSat,
      mintUrls: [args.mintUrl],
      recipientNprofile: args.deviceNprofile,
      requestId: args.paymentId,
    }),
  });
```

The request carries `a` (amount), `u: "sat"`, `s: true` (single use), `m` (mints), one `nostr` transport to the nprofile tagged `["n", "17"]`, and `i` (id) and `d` (description) when given, in that order; the same arguments always encode to the same text. `buildBip321PaymentUri` leaves out an empty leg and returns `null` when both are empty.

`decodePaymentRequest(text)` reads a `creqA…` request back (`amount`, `unit`, `singleUse`, `mints`, `id`, `description`, `transports`) and returns `null` for anything else; it checks the shape only, so validate the amount, unit and transport you need. `parseBip321Uri` and `pickBip321PayableLeg` read a scanned `bitcoin:` URI and pick the leg to settle (`creq` first, then `lightning`, `lnurl`, a lightning address).

## Taking a payment

A point-of-sale device that shows such a URI waits for either leg:

1. Lightning: start a [topup](./topup.md) for the amount with a `lockingKey` the device can derive again (NUT-20), and show `handle.quote.invoice` as the `lightning` leg. `handle.result` resolves once the invoice is paid and the proofs are minted into the wallet.
2. Cashu: the payer sends the token to the nprofile as a NIP-17 direct message, which a Nostr client such as `@linky-fit/linkstr` receives as a chat message. A Linky payer sends a bare `cashuB…` token; other wallets send the NUT-18 payment payload, a JSON `{id, memo, mint, unit, proofs}`. `decodePaymentRequestPayload(text)` reads the payload's `requestId`, `mint`, `unit` and face `amount` so you can match it to the open request; a bare token names no request, so match it by mint and amount. Receive either text unchanged with `Receive.receive(new ReceiveDraft({ text, automatic: true }))`; it accepts both forms.

```ts
import { Effect } from "effect";
import { Receive, ReceiveDraft } from "@linky-fit/linkshu";
import { decodePaymentRequestPayload } from "@linky-fit/linkshu/payment-request";

const receiveForRequest = (messageText: string, paymentId: string) =>
  Effect.gen(function* () {
    const payload = decodePaymentRequestPayload(messageText);
    if (payload !== null && payload.requestId !== paymentId) return null;
    const receive = yield* Receive;
    return yield* receive.receive(
      new ReceiveDraft({ text: messageText, automatic: true }),
    );
  });
```

The receipt's `amount` is what reached the wallet, after the mint's input fee; compare it with what you asked for. Once one leg paid, close the topup's scope. The unpaid quote stays a `pending` topup; the handle a later `Topup.resumePending` returns for it fails with `QuoteExpired` once the mint reports it `UNPAID` past its expiry, and the operation closes `failed`.
