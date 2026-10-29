# Payment requests

Helpers for asking to be paid and for paying: NUT-18 `creqA…` payment requests, BIP-321 `bitcoin:` URIs that offer a Lightning invoice and a Cashu request side by side, and the NUT-18 `post` transport. They need no wallet runtime and are also exported without cashu-ts from `@linky-fit/linkshu/payment-request`.

## Building a request

`encodeNostrPaymentRequest` builds a single-use `sat` request payable at the given mints, whose payer sends the payment as a NIP-17 message to an nprofile. `buildBip321PaymentUri` puts it next to a bolt11 invoice as `bitcoin:?lightning=<bolt11>&creq=<creqA…>`; a wallet pays whichever leg it understands.

```ts
import {
  buildBip321PaymentUri,
  encodeNostrPaymentRequest,
  type PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";

const paymentUri = (args: {
  amountSat: number;
  mintUrl: string;
  invoice: string;
  deviceNprofile: string;
  paymentId: PaymentRequestId;
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

The request carries `a` (amount, left out for `amount: null`, which leaves it to the payer), `u: "sat"`, `s: true` (single use), `m` (mints, each once), one `nostr` transport to the nprofile tagged `["n", "17"]`, `i` (id) and `d` (description) when given, in that order; the same arguments always encode to the same text. `requestId` is a `PaymentRequestId` (`PaymentRequestId.make(text)`), the only thing that ties a payment to the request: pick a fresh random one per request and keep it to recognize the payment. It is not a Nostr event id. `buildBip321PaymentUri` leaves out an empty leg and returns `null` when both are empty.

`decodePaymentRequest(text)` reads a `creqA…` request back (`amount`, `unit`, `singleUse`, `mints`, `mintsAdvisory`, `methods`, `id`, `description`, `transports` in the payee's order of preference, and `lock`, the NUT-10 condition the proofs must carry) and returns `null` for anything else; it checks the shape only, so validate the amount, unit, lock and transport you need. A request may leave out the amount (the payer chooses it), the id, the mints (any mint) and the transports. `parseBip321Uri` and `pickBip321PayableLeg` read a scanned `bitcoin:` URI and pick the leg to settle: `creq` first when `canPayCashuRequest(creq)` says the wallet can pay it from a mint it holds (the default), then `lightning`, `lnurl`, a lightning address, and a `creq` the wallet cannot pay from its mints last.

## Taking a payment

A point-of-sale device that shows such a URI waits for either leg:

1. Lightning: start a [topup](./topup.md) for the amount with a `lockingKey` the device can derive again (NUT-20), and show `handle.quote.invoice` as the `lightning` leg. `handle.result` resolves once the invoice is paid and the proofs are minted into the wallet.
2. Cashu: the payer sends the NUT-18 payment payload, a JSON `{id, memo, mint, unit, proofs}`, to the nprofile as a NIP-17 direct message, which a Nostr client such as `@linky-fit/linkstr` receives as a chat message. `decodePaymentRequestPayload(text)` reads the payload's `requestId`, `mint`, `unit` and face `amount`; the payload pays the open request whose id equals `requestId`. A bare `cashuA…`/`cashuB…` token, as older payers send, names no request: receive it as an ordinary token, it pays nothing. Receive the text unchanged with `Receive.receive(new ReceiveDraft({ text, automatic: true }))`; it accepts both forms.

```ts
import { Effect } from "effect";
import { Receive, ReceiveDraft } from "@linky-fit/linkshu";
import {
  decodePaymentRequestPayload,
  type PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";

const receiveForRequest = (messageText: string, paymentId: PaymentRequestId) =>
  Effect.gen(function* () {
    const receive = yield* Receive;
    const receipt = yield* receive.receive(
      new ReceiveDraft({ text: messageText, automatic: true }),
    );
    const payload = decodePaymentRequestPayload(messageText);
    return { receipt, paysRequest: payload?.requestId === paymentId };
  });
```

Receive it either way; only `paysRequest` closes the request. The receipt's `amount` is what reached the wallet, after the mint's input fee; compare it with what you asked for. Once one leg paid, close the topup's scope. The unpaid quote stays a `pending` topup; the handle a later `Topup.resumePending` returns for it fails with `QuoteExpired` once the mint reports it `UNPAID` past its expiry, and the operation closes `failed`.

## Paying a request

Pay from one of the request's `mints` with a [send](./send.md) of `produceAs: "pending"` and `includeRecipientFee: true`, since the requested amount is what the payee must net after redeeming the proofs. Lock it with `lockTo` when the request's `lock` is a P2PK condition. Any mint will do when the request lists none, and when `mintsAdvisory` is true the request's mints are only preferred. Paying from a mint outside the list (or from any mint when there is none) adds the payee's melt fee to the amount: the `fee` of the cheapest of the request's `methods` your mint supports. When no mint the wallet holds can pay, move the amount to one of the request's mints with an [autoswap](./autoswap.md) first and send from there.

Then build the payload with `encodePaymentRequestPayload({ id, memo, mint, unit, proofs })`: `id` is the request's `id`, `proofs` is `SendReceipt.proofs`, and `id` and `memo` are left out when empty. Deliver that text over the first transport you support, in the order the request lists them: as the content of a NIP-17 message to a `nostr` transport's nprofile, on the relays the nprofile names, when the transport's `n` tags list `17` or it has none, or as the body of a POST to a `post` transport (below). Close the send with `Tokens.forget` once the transport took it, or take it back with `Tokens.returnToWallet` when it did not.

### Over POST

A request whose transport is `post` (`transports[i].type === "post"`, the URL in `target`) is paid by POSTing the NUT-18 payment payload to that URL. Check the URL with `isAllowedPaymentRequestPostUrl(url, { allowHttp })` before creating the token: the payload carries bearer proofs, so only `https:` passes, and `allowHttp: true` admits `http:` for local development.

```ts
import { Effect, Result } from "effect";
import { Send, SendDraft, Tokens } from "@linky-fit/linkshu";
import type { Amount, MintUrl } from "@linky-fit/linkshu";
import {
  isAllowedPaymentRequestPostUrl,
  postPaymentRequestPayload,
  type PaymentRequestId,
} from "@linky-fit/linkshu/payment-request";

const payOverPost = (
  url: string,
  requestId: PaymentRequestId | null,
  mint: MintUrl,
  amount: Amount,
) =>
  Effect.gen(function* () {
    if (!isAllowedPaymentRequestPostUrl(url, { allowHttp: false }))
      return "insecure";
    const receipt = yield* (yield* Send).send(
      new SendDraft({ mint, amount, produceAs: "pending" }),
    );
    const delivery = yield* Effect.promise(() =>
      postPaymentRequestPayload({
        url,
        payload: {
          id: requestId,
          mint: receipt.mint,
          unit: receipt.unit,
          proofs: receipt.proofs,
        },
      }),
    );
    const tokens = yield* Tokens;
    if (delivery._tag === "Delivered") {
      yield* Effect.result(tokens.forget(receipt.operationId));
      return "paid";
    }
    const returned = yield* Effect.result(
      tokens.returnToWallet(receipt.operationId),
    );
    return Result.isSuccess(returned) ? "returned" : "return failed";
  });
```

`postPaymentRequestPayload({ url, payload, allowHttp, fetch })` sends `encodePaymentRequestPayload(payload)` with no credentials, and resolves, never rejects, with `Delivered` for a 2xx answer, `HttpError` with the `status` otherwise, `NetworkError` with a `detail` when the request did not complete, and `InsecureUrl` without sending anything when the URL fails the check above. `fetch` defaults to the global one. Take `proofs` from `SendReceipt.proofs`, not from the token text, whose v4 encoding shortens keyset ids. Any outcome but `Delivered` may still have handed the proofs to the payee, so take the send back with `Tokens.returnToWallet`, which re-receives it and kills the payee's copy at the mint ([tokens.md](./tokens.md#returntowallet)).
