# Protocol

An on-chain transfer is a conversation between one Linky user and the on-chain operator. Linky knows the operator by a fixed npub; the operator learns each user from their first request.

## Messages

Every message is a linkstr [app message](../../linkstr/docs/app-messages.md) on `onchainTransferChannel`, namespace `ONCHAIN_TRANSFER_APP_NAMESPACE` (`linky.onchain-transfer`). Build one with `onchainTransferChannel.draft(to, message)` and enqueue it on the outbox as `{ _tag: "appMessage", draft }`, so it survives going offline; read an `AppMessageReceived` with `onchainTransferChannel.decode(event)`, which is `Option.none()` for another app's message or one the schema rejects. Every message carries `v: 1` and the transfer's `transferId`, an `OnchainTransferId` the user creates with `createId<"OnchainTransfer">()`.

| Message                  | Sent by  | Carries                                                                                                                                              |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OnchainTransferRequest` | user     | `direction`, `amount` (sats the user gets; absent on a receive of any amount), the `feeBasisPoints` the user saw, and per direction the fields below |
| `OnchainTransferCancel`  | user     | only the transfer id                                                                                                                                 |
| `OnchainTransferUpdate`  | operator | the transfer's whole current state: `revision`, `status`, the locked `fee` and `sendAmount`, and what the status needs                               |

A send request must carry `amount` and `payoutAddress`; a receive request must carry `refund` (`{ to: "address", address }` or `{ to: "sender" }`) and `paymentRequest`, the user's NUT-18 `creqA` at the config's mint, with request id = transfer id and a Nostr transport to the user. The schema rejects a request without them.

A receive request without `amount` is a **receive of any amount**: the user deposits whatever they like between the config's `minReceiveAmount` and `maxReceiveAmount` plus the fee, and the deposit sets the terms (see [config](./config.md#deposit-terms)). Its `paymentRequest` names no amount either. Linky asks for one only under a config that names `minReceiveAmount`, and the operator denies one under a profile without it; an older operator ignores the request, since its schema requires the amount.

Linky and the operator app release separately, so every message must keep validating with the schema of the release that wrote it: add optional fields only, never rename or tighten one. Unknown fields are ignored on decode.

## On-chain send

1. Linky stores the transfer row and sends `OnchainTransferRequest` with the payout address.
2. Right away, without waiting for an answer, Linky pays the operator `sendAmount` (`amountWithServiceFee(amount, feeBasisPoints)`) as a NUT-18 payment at the config's mint, request id = transfer id, in a chat message to the operator, and records `sentAtSec`. The request it pays is one Linky builds itself; the operator never has to send one.
3. The operator accepts every send request on arrival: `accepted` with `paymentRequest`, its own `creqA` for `sendAmount`, request id = transfer id, Nostr transport to the operator, which a Linky release from before step 2 pays. A request it would rather not take (paused, an amount not offered, another fee, an address of another network) is accepted all the same and flagged for the operator, who refunds the ecash once it arrived.
4. The ecash arrives at the operator in a chat message naming the transfer id: `fundsReceived` with `receivedAmount` once at least `sendAmount` arrived. It may arrive before the request or before the operator accepted; the operator keeps it until it has accepted the request, then reports `fundsReceived`. Only sats at the config's mint count; ecash from another mint or in another unit is kept but pays no transfer.
5. The operator pays `amount` to the payout address and sends `completed` with the payout `txid`. The operator pays the miner fee. One transaction completes one transfer.

## On-chain receive

1. Linky stores the transfer row and sends `OnchainTransferRequest` with the refund choice and the user's payment request.
2. The operator answers `accepted` with a fresh `depositAddress` (see [deposit addresses](./bitcoin.md#deposit-addresses)), or `denied`. The operator app answers on arrival; only a request it cannot give an address to (no key, Esplora silent) waits for the operator.
3. The user sends `sendAmount` to the deposit address (`bitcoinPaymentUri`); on a receive of any amount, whatever they like within the config's limits, to the bare address.
4. The operator watches the address: `fundsSeen` with `txid`, `confirmations` and `receivedAmount` whenever they change, then `fundsReceived` at `REQUIRED_CONFIRMATIONS` (2) once at least `sendAmount` arrived. A deposit short of `sendAmount` stays `fundsSeen` until more arrives or the operator refunds it. On a receive of any amount, `fee` and `sendAmount` are the minimum's until the deposit is seen, and `depositTerms` of the deposit from then on; a deposit short of the minimum with its fee stays short.
5. Once at least `sendAmount` arrived, the operator pays the user's payment request `amount` (`sendAmount - fee`) and sends `completed`. Linky also counts the transfer completed once the receives naming the request's id brought in its amount, even before that update arrives.

## Cancel, deny and refund

The user may send `OnchainTransferCancel` while `canUserCancel(phase)`; Linky shows the transfer cancelled from then on unless funds already moved. The operator answers `cancelled` while no funds moved, also before it accepted; otherwise the two settle it in the chat. The operator may deny a request it cannot take (paused, an amount `isOfferedAmount` rejects, a service fee other than the current one, an address for another network) and cancel an accepted transfer. A transfer whose funds arrived but cannot complete ends `refunded`: for an on-chain receive the operator pays the refund address, or the address the deposit came from, and sends `refundTxid`; for an on-chain send the operator sends the received ecash back in the chat. The `refunded` update carries `refundAmount`, the sats returned, when the operator could tell.

## Statuses

`canOperatorMove(from, to)` is the rule the operator app enforces before sending an update; `from` is `null` before the first one.

| From            | To                                                                        |
| --------------- | ------------------------------------------------------------------------- |
| none            | `accepted`, `denied`, `cancelled` (the user withdrew the request)         |
| `accepted`      | `fundsSeen`, `fundsReceived`, `cancelled`                                 |
| `fundsSeen`     | `fundsSeen` (new confirmations), `fundsReceived`, `cancelled`, `refunded` |
| `fundsReceived` | `completed`, `refunded`                                                   |

`denied`, `completed`, `cancelled` and `refunded` are terminal (`isTerminalStatus`). An on-chain send never uses `fundsSeen`.

## Revisions and replays

An update carries the whole state, not a change, numbered by `revision`: 1 for the first, one more for each next one of that transfer. `newerTransferUpdate(current, next)` keeps the higher revision, so a replayed or reordered update changes nothing. The inbox replays messages after restarts: apply every message idempotently, by `messageId` and by revision. The operator stores a request once per transfer id, whoever sends it again.

## Trust

- Linky acts on transfer messages only from the operator's pubkey, and on an update only for a transfer it holds with that operator as the peer.
- The operator acts on an `OnchainTransferCancel` only from the user who requested that transfer (the row's `peerPubkey`); requests come from anyone.
- Ecash is matched to a transfer only by the NUT-18 request id = transfer id, never by amount.

## Phases Linky shows

`onchainTransferPhase({ direction, update, userCancelledAtSec, sentAtSec, requestPaid })` is pure: pass the newest update, the user's cancel time, `sentAtSec` (send) and whether the user's request is paid in full (receive).

| Update                            | Send                                  | Receive                                                        |
| --------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| none                              | `waitingForDetails`, `sent` once paid | `waitingForDetails`                                            |
| `accepted`                        | `readyToSend`, `sent` once paid       | `awaitingDeposit`                                              |
| `fundsSeen`                       | `sent`                                | `depositSeen`, `depositConfirming` from the first confirmation |
| `fundsReceived`                   | `sent`                                | `waitingForEcash`                                              |
| either, `receivedAmount` short    | `sent`                                | `shortDeposit`                                                 |
| `completed`                       | `completed`                           | `waitingForEcash`                                              |
| `denied`, `cancelled`, `refunded` | the same                              | the same                                                       |

For an on-chain receive, a paid request is `completed` whatever the update, and only a paid request is: the operator's `completed` alone leaves it `waitingForEcash`, so Linky never shows sats as received before its own receives naming the request brought them in. A user cancel turns `waitingForDetails`, `readyToSend` and `awaitingDeposit` into `cancelled`, the phases `canUserCancel` allows; once funds moved it changes nothing. Linky shows the deposit's confirmations as these phases only, never as a count.

## The stored update

linksync's `onchainTransfer` row keeps the newest update in one `updateJson` column, so sync never splits it. Write it with `encodeTransferUpdateColumn(update)`, which leaves out `paymentRequest` (it has its own `operatorPaymentRequest` column) and shortens a `reason` whose JSON escapes would pass the column's 1000 characters; read it with `decodeTransferUpdateColumn(column)`, `null` for an empty or unreadable column.
