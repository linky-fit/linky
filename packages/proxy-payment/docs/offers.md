# Offers

A proxy payment is one **offer** (`offerId`) sent to several peers. Every snapshot linkstr delivers (`BankOfferSnapshotReceived`, `OwnBankOfferSnapshotConfirmed`) or every receipt this device gets for its own send lands in one `BankPaymentOfferState`: a list of **threads** (`BankPaymentOffer`, one per peer `Pubkey` and `BankOfferId`, always the latest authorized status; every id keeps its linkstr brand) plus a buffer of payer snapshots waiting for their offerer's snapshot.

```ts
import {
  applyBankPaymentOfferReceipt,
  applyBankPaymentOfferSnapshot,
  emptyBankPaymentOfferState,
  type BankPaymentOfferState,
} from "@linky/proxy-payment";

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

`BankPaymentOffer` extends the decoded content (`BankPaymentOfferInfo`: status, amounts, timestamps, `spdPayload`, `text`) with `peer`, `offererPublicKey`, `createdAtSec` (the first snapshot's send time), `snapshotId` and the encoded `content`, byte for byte what the wire carried. `decodeBankPaymentOffer(content)` reads that JSON back; it is lenient about every optional field so an offer from another build still renders.

## Authorization

`applyBankPaymentOfferSnapshot` rejects (returns the same state) when:

- the author's role does not match the status (`isOffererBankPaymentOfferStatus`): only the offerer sends `offered`, `bank_details_sent`, `accepted_by_other`, `canceled`, `settled`;
- the offerer is neither the peer nor me, or differs from the offerer of any known thread of the offer;
- a known thread has a different `amountSat`, `amountText` or `initiatedAtSec`;
- the snapshot is older than the known thread (`sentAt`, then `bankPaymentOfferStatusRank` on ties), the thread already ended for everyone (`canceled`/`settled`), or a payer status skips a phase;
- the status is not terminal and either the offer already ended for another peer or the phase has expired (`isBankPaymentOfferExpired`).

A payer snapshot with no known thread, or `bank_paid` before `bank_details_sent`, waits in `pending` (at most 256, oldest dropped) and is replayed in `sentAt` order once the offerer's snapshot for that peer is accepted. Payer copies never change `expiresAtSec`, `extensionSec` or `spdPayload`; those stay as the offerer sent them, and `bankPaidAtSec` is stamped from the payer's `sentAt`.

The offerer's `accepted_by_other` decision overrides a pending `accepted` status regardless of timestamp. A recipient can accept after the offerer chose someone else but before that decision reaches them; their later acceptance must not hide the decision. This applies to incoming snapshots, self copies and send receipts. A delayed acceptance cannot reopen the closed thread, and the losing recipient receives no bank details.

`applyBankPaymentOfferReceipt` trusts the receipt's content because this device sent it, but applies the same staleness rules as incoming snapshots before replacing a known thread. A delayed `accepted` receipt cannot overwrite bank details that arrived while the send was awaiting acknowledgments. A stale receipt returns the unchanged state and the current offer, so a successful send remains successful without rolling back the UI. `createdAtSec` keeps the thread's earliest time when merging an accepted update.

## Rules

| Function                                                                      | Meaning                                                                                                           |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `isTerminalBankPaymentOfferStatus`                                            | ends one peer's thread (`accepted_by_other`, `canceled`, `declined`, `settled`)                                   |
| `isWholeOfferTerminalStatus`                                                  | ends the offer for everyone (`canceled`, `settled`)                                                               |
| `bankPaymentOfferStatusRank`                                                  | merge precedence between same-second snapshots, not the lifecycle order                                           |
| `hasBankPaymentOfferTimedPhase`                                               | statuses with a countdown (`offered`, `accepted`, `bank_details_sent`, `bank_paid`)                               |
| `bankPaymentOfferExpiresAtSec`                                                | explicit `expiresAtSec`, else the phase start plus `BANK_PAYMENT_OFFER_PHASE_TTL_SEC` (5 min); null when terminal |
| `bankPaymentOfferResponseDurationSec`                                         | seconds from initiation to the bank payment                                                                       |
| `clampBankPaymentOfferRecipientCount`, `clampBankPaymentOfferStaggerDelaySec` | the SPD page limits (1–10 recipients, 0–30 s in 5 s steps)                                                        |

## Selectors

All selectors take `state.offers` and are pure; the app runs them in memos and effects.

- `activeBankPaymentOffers(offers, nowSec)` — peers with a live thread of an offer that has not ended, plus the next expiry to re-render at. Drives the "proxy payments" contact section.
- `bankPaymentOfferResponderSteps(offers, me)` — per own offer: `ended`, the `winner` who already holds the bank details, else the earliest `candidate` acceptance (ties by peer), and the `losers` still offered or accepted. The app sends `bank_details_sent` to the candidate under a per-offer lease lock and `accepted_by_other` to the losers. `hasPendingBankPaymentOfferResponderWork` says whether to retry later.
- `ownBankPaymentOfferExpiries(offers, me, nowSec)` — per own offer, the deadline of its most advanced phase (`bank_paid` > `bank_details_sent` > `accepted` > `offered`) across recipients; the app cancels the whole group at that time.
- `bankPaymentOfferGroupResponses(offers, offerId, "canceled" | "settled")` — the threads a whole-offer status must reach (skipping ones already there, never canceling a settled thread) and which single peer gets the push for a cancellation (most advanced, then earliest).
- `lastBankPaymentOfferResponseSecByPeer(offers, me)` — how long each peer took on my most recent offer they paid, shown on the SPD page.
- `isBankPaymentOfferCanceled(offers, offerId)`, `findBankPaymentOffer(offers, peer, offerId)`, `bankPaymentOffersOf(offers, offerId)`.

## Drafts

`bankPaymentOfferedDraft({ to, offerId, offerer, amountText, amountSat, expiresAtSec? })` opens a thread. `bankPaymentOfferResponseDraft(offer, nextStatus, me, options?)` builds the next snapshot of a known thread from its authorized fields, returning `null` when `me` may not send `nextStatus` on it; `options` carry an extension (`expiresAtSec`, `extensionSec`), the bank QR to hand over (`spdPayload`) and `withPush`. Both stamp a fresh `clientId` and the fixed wire text (`bankPaymentOfferMessageText`).

## Stagger

`bankPaymentOfferStaggerQueue({ peers, delaySec, firstSentAtSec, ... })` turns the recipients after the first one into a `BankPaymentOfferStaggerRecord` (a `Schema`, so the app can persist it): each peer is due `firstSentAtSec + (index + 1) * delaySec` and the whole queue expires with the first send. `bankPaymentOfferStaggerDue(record, offers, nowSec)` splits due peers into `send` and `alreadyOffered` (a thread exists, another tab sent it) and reports `nextDueAtSec`; `isBankPaymentOfferStaggerQueueOpen(record, offers)` is false once any recipient moved past `offered`/`declined`, after which the app drops the queue.
