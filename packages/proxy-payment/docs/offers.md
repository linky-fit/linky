# Offers

A proxy payment is one offer (`offerId`) sent to several peers. Every snapshot linkstr delivers (`BankOfferSnapshotReceived`, `OwnBankOfferSnapshotConfirmed`) and every receipt for this device's own sends land in one `BankPaymentOfferState`: threads (`BankPaymentOffer`, one per peer pubkey and offer id, at its latest authorized status) plus `pending` payer snapshots waiting for their offerer's snapshot.

```ts
import {
  applyBankPaymentOfferReceipt,
  applyBankPaymentOfferSnapshot,
  emptyBankPaymentOfferState,
  type BankPaymentOfferState,
} from "@linky-fit/proxy-payment";

let state: BankPaymentOfferState = emptyBankPaymentOfferState;

// Inbound: every authenticated snapshot, live or backfill, idempotently.
const { state: next, accepted } = applyBankPaymentOfferSnapshot(
  state,
  event,
  myPubkey,
  nowSec,
);
state = next;
for (const { offer, event: snapshot } of accepted) notify(offer, snapshot);

// Outbound: the receipt of a draft this device published.
state = applyBankPaymentOfferReceipt(state, peerPubkey, receipt).state;
```

A thread is the decoded content (`BankPaymentOfferInfo`) plus its identity on the wire; `decodeBankPaymentOffer(content)` reads the content JSON back, lenient about every optional field.

## Authorization

`applyBankPaymentOfferSnapshot` returns the same state when:

- the author's role does not match the status (`isOffererBankPaymentOfferStatus`): only the offerer sends `offered`, `bank_details_sent`, `accepted_by_other`, `canceled`, `settled`;
- the offerer is neither the peer nor me, or differs from the offerer of any known thread of the offer;
- a known thread has a different `amountSat`, `amountText` or `initiatedAtSec`;
- the snapshot is older than the known thread (`sentAt`, then `bankPaymentOfferStatusRank` on ties) or the thread already ended for everyone (`canceled`/`settled`);
- a payer snapshot other than `bank_paid` arrives once the thread has left `offered`: a payer's first answer is final;
- the status is not terminal and either the offer already ended for another peer or the phase has expired (`isBankPaymentOfferExpired`).

A payer snapshot with no known thread, or `bank_paid` before `bank_details_sent`, waits in `pending` (at most 256, oldest dropped) and is replayed in `sentAt` order once the offerer's snapshot for that peer is accepted. Payer copies never change `expiresAtSec`, `extensionSec` or `spdPayload`; those stay as the offerer sent them, and `bankPaidAtSec` is stamped from the payer's `sentAt`.

The offerer's `accepted_by_other` overrides a pending `accepted` regardless of timestamp, for incoming snapshots, self copies and send receipts alike: a recipient can accept after the offerer chose someone else but before that decision reaches them, and the later acceptance must not hide it.

`applyBankPaymentOfferReceipt` trusts the receipt's content because this device sent it, but applies the same staleness rules before replacing a known thread, so a delayed `accepted` receipt cannot overwrite bank details that arrived meanwhile. A stale receipt returns the unchanged state and the current offer. `createdAtSec` keeps the thread's earliest time when merging.

## Rules

`isTerminalBankPaymentOfferStatus` ends one peer's thread (`accepted_by_other`, `canceled`, `declined`, `settled`); `isWholeOfferTerminalStatus` ends the offer for everyone (`canceled`, `settled`). `bankPaymentOfferStatusRank` is merge precedence between same-second snapshots, not the lifecycle order.

`bankPaymentOfferExpiresAtSec` is the explicit `expiresAtSec`, else the phase start plus `BANK_PAYMENT_OFFER_PHASE_TTL_SEC` (5 min), and `null` once terminal; `hasBankPaymentOfferTimedPhase` names the statuses with a countdown.

`clampBankPaymentOfferRecipientCount` and `clampBankPaymentOfferStaggerDelaySec` round to an integer and clamp to 1 to 10 recipients and 0 to 30 s; a non-finite value becomes the default (2, 0). `BANK_PAYMENT_OFFER_STAGGER_DELAY_STEP_SEC` (5) is for a slider's step; the clamp does not snap to it.

## Selectors

All selectors take `state.offers` and are pure; the consumer's effects run on them.

- `activeBankPaymentOffers(offers, nowSec)`: peers with a live thread of an offer that has not ended, plus the next expiry to re-render at.
- `bankPaymentOfferResponderSteps(offers, me)`: per own offer, the `winner` who already holds the bank details, else the earliest `candidate` acceptance (ties by peer), and the `losers` still offered or accepted. The consumer sends `bank_details_sent` to the candidate and, once delivered, `accepted_by_other` to the losers. `hasPendingBankPaymentOfferResponderWork(offers, me, nowSec)` says whether an unexpired acceptance still waits for bank details.
- `ownBankPaymentOfferExpiries(offers, me, nowSec)`: per own offer, the deadline of its most advanced phase; the consumer cancels the whole group then.
- `bankPaymentOfferGroupResponses(offers, offerId, "canceled" | "settled")`: the threads a whole-offer status must still reach (never canceling a settled thread) and the single peer that gets the push for a cancellation.
- `lastBankPaymentOfferResponseSecByPeer(offers, me)`: how long each peer took on my most recent offer they paid.

## Drafts

`bankPaymentOfferedDraft({ to, offerId, offerer, amountText, amountSat, expiresAtSec? })` opens a thread, or returns `null` for an invalid pubkey, offer id or empty amount. `bankPaymentOfferResponseDraft(offer, nextStatus, me, options?)` builds the next snapshot of a known thread from its authorized fields, or `null` when `me` may not send `nextStatus` on it; `options` carry an extension (`expiresAtSec`, `extensionSec`), the bank QR to hand over (`spdPayload`) and `withPush`. Both stamp a fresh `clientId` and the wire text (`bankPaymentOfferMessageText`).

## Stagger

`bankPaymentOfferStaggerQueue({ peers, delaySec, firstSentAtSec, ... })` turns the recipients after the first one into a `BankPaymentOfferStaggerRecord` (a `Schema`, persistable), or `null` for no peers: each peer is due at `firstSentAtSec + (index + 1) * delaySec` and the queue expires with the first send's phase. `bankPaymentOfferStaggerDue(record, offers, nowSec)` splits due peers into `send` and `alreadyOffered` (another tab sent it) and reports `nextDueAtSec`. `isBankPaymentOfferStaggerRecordExpired(record, nowSec)` treats a future `createdAtSec` as expired too. `isBankPaymentOfferStaggerQueueOpen(record, offers)` is false once any recipient moved past `offered`/`declined`; the consumer then drops the queue.
