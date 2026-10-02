# Linky

Linky is a local-first app where contacts, private Nostr conversations and a Cashu/Lightning wallet live together, so paying someone is part of talking to them. This glossary fixes the words we use for its domain.

## Identity and people

**Recovery seed**:
The user's SLIP-39 secret; every key the account uses derives from it.
_Avoid_: mnemonic, backup phrase, master key

**Cashu seed**:
The key material derived from the recovery seed that wallet proofs are generated from.
_Avoid_: wallet mnemonic

**Identity**:
The Nostr key pair the user appears as to others.
_Avoid_: account, user, profile

**Custom identity**:
An identity whose secret key the user pasted in instead of deriving it from the recovery seed.
_Avoid_: imported account, nsec login

**Profile**:
The public metadata an identity publishes about itself, such as name, picture and lightning address.
_Avoid_: user info, card

**Contact**:
A person the user saved, known by their public key.
_Avoid_: friend, buddy, user

**Override**:
A contact field the user set by hand, which the peer's profile no longer changes.
_Avoid_: custom name, alias

**Peer**:
The other party of a conversation or offer, whether or not they are a contact.
_Avoid_: counterparty, remote user, other side

**Unknown sender**:
A peer who wrote to the user but is not a contact; they stay outside contacts until the user adds them.
_Avoid_: stranger, anonymous contact

## Messaging

**Conversation**:
The ongoing exchange between the user and one peer.
_Avoid_: chat, thread, room

**Message**:
One piece of content sent in a conversation: text, a cashu token, a payment request or attachments.
_Avoid_: post, note, event

**Edit**:
A newer version of an own message that replaces its text but keeps its identity, so reactions and replies still point to it.
_Avoid_: correction, revision

**Reaction**:
An emoji a participant attaches to a message.
_Avoid_: like, emote

**Attachment**:
A file sent as its own message; only PDFs are supported.
_Avoid_: file message, upload

**Read cursor**:
The point in a conversation, expressed as a message time, up to which one side has read; it only moves forward.
_Avoid_: unread flag, read marker

**Seen receipt**:
A signal telling the peer how far the user has read, updating the peer's view of the user's read cursor.
_Avoid_: read receipt, double tick

**Relay**:
A Nostr server that stores and forwards events; the user has separate read and write relays.
_Avoid_: server, node

**Rumor**:
The unsigned inner event that carries a message's content; its id is the message's lasting identity.
_Avoid_: payload, inner message

**Gift wrap**:
The encrypted envelope a rumor travels in, so relays see only ciphertext and a recipient.
_Avoid_: encrypted event, DM event

**Self copy**:
The gift wrap of a send addressed to the user, which is how their other devices learn about it.
_Avoid_: backup copy, sent copy

**Recipient copy**:
The gift wrap of a send addressed to the peer; a send counts as delivered only once a relay accepted it.
_Avoid_: peer copy

**Own echo**:
The user's own send coming back from a relay; it confirms a pending message and is never shown as an incoming one.
_Avoid_: loopback, self message

**Plain event**:
A signed, public Nostr event published as-is, such as a profile or relay list.
_Avoid_: public message, unencrypted message

**Outbox**:
The durable queue that keeps retrying sends until a relay accepts them.
_Avoid_: send queue, retry queue

**Backfill**:
Events a relay replays from storage when the user connects, as opposed to **live** events that arrive afterwards; only live events interrupt the user.
_Avoid_: history sync, catch-up

**Push marker**:
A plaintext tag on a gift wrap that asks the push service to notify the recipient; it deliberately reveals that much metadata.
_Avoid_: notification flag

**Payment notice**:
A wake-up signal telling a peer that the user just paid them in the conversation; it carries no value itself.
_Avoid_: payment message, payment receipt

**Payment telemetry**:
An anonymous report of a payment's outcome, sent to a collector for diagnostics.
_Avoid_: analytics, tracking

## Wallet

**Mint**:
A Cashu server that issues and redeems ecash for Lightning payments; the wallet holds funds at one or more mints.
_Avoid_: bank, custodian, server

**Default mint**:
The mint new funds arrive at; changing it never moves existing balances.
_Avoid_: primary mint, main mint

**Test mint**:
A mint that issues ecash without real Lightning behind it, hidden from balances unless the user allows test mints.
_Avoid_: fake mint, dev mint

**Proof**:
One unit of ecash the wallet holds at a mint.
_Avoid_: coin, note

**Token**:
Proofs encoded as shareable text, which whoever claims it first can redeem.
_Avoid_: ecash string, cashu link, voucher

**Balance**:
The sum of the user's available proofs across all mints.
_Avoid_: funds, total

**Spendable balance**:
The largest balance at a single mint, because one payment never spans mints.
_Avoid_: available balance

**Topup**:
Adding funds to the wallet by paying a Lightning invoice that a mint turns into proofs.
_Avoid_: deposit, charge, fund

**Melt**:
Paying a Lightning invoice with proofs the mint redeems.
_Avoid_: withdrawal, cash out, payout

**Autoswap**:
Moving funds from one mint to another by melting at the source and topping up at the target; it only happens on the user's action.
_Avoid_: transfer, rebalance, migrate funds

**Send**:
Turning proofs into a token for someone else to claim.
_Avoid_: pay, transfer

**Receive**:
Redeeming a token at its mint into the user's own proofs.
_Avoid_: claim, redeem, accept

**Deferred receive**:
A token kept because its mint could not be reached, loaded or asked when it arrived; any device receives it once the mint answers.
_Avoid_: parked token, queued claim

**Discard**:
Giving up a deferred receive at the user's request; nothing is received, so the token's value is gone unless the user kept its text.
_Avoid_: forget, cancel, delete

**Operation**:
A recorded wallet action (topup, melt, autoswap, send, receive or deferred receive) and its progress; operations are never deleted.
_Avoid_: job, task

**Pending operation**:
An operation waiting for the mint's final answer, which any of the user's devices can finish later.
_Avoid_: in-flight payment, stuck payment

**Transaction**:
An entry in the payment history the user sees; it is a view of the wallet's operations, not the source of truth.
_Avoid_: payment, operation, record

**Lightning address**:
An email-like address anyone can pay over Lightning.
_Avoid_: LN address, LUD-16

**npub.cash**:
The hosted service that gives each identity a lightning address paying into the user's wallet.
_Avoid_: address service, custodial address

**Payment request**:
A message asking the peer to pay a stated amount; once received it cannot be changed.
_Avoid_: invoice, bill, request for payment

**Auto-pay limit**:
The amount up to which invoices and payment requests are paid without asking.
_Avoid_: spending limit, confirmation threshold

**LNURL-auth login**:
Linky signing the user into another website with a key derived from their identity.
_Avoid_: Lightning login, wallet login

**Bolt card**:
The NFC card a device emulates so a bolt card POS can charge the user's wallet; it belongs to that one device.
_Avoid_: virtual card, NFC wallet, contactless card

**Card tap**:
One payment started by holding the phone to a POS while the bolt card is active, which it is while the Send screen is open and the user turned the card on in settings.
_Avoid_: NFC payment, contactless payment

**Card bridge**:
The service that hosts the bolt card's LNURL-withdraw endpoint and relays its requests to the device; it never holds funds.
_Avoid_: bolt card server, card backend, lnurlw server

## Proxy payments

**Proxy payment**:
Getting a bank transfer paid by a peer in exchange for sats.
_Avoid_: bank payment, fiat payment, exchange

**Bank QR**:
A scanned bank payment code in SPD, EPC or PAY by square format that describes the transfer to be paid.
_Avoid_: payment QR, SPAYD

**Offer**:
A proxy payment request the offerer sends to several peers at once, of whom only one ends up paying.
_Avoid_: bank offer, request, bid

**Offerer**:
The user who holds the bank QR and pays sats to whoever pays it.
_Avoid_: requester, initiator

**Payer**:
A peer an offer was sent to, who may accept it and pay the bank transfer.
_Avoid_: responder, counterparty, recipient

**Stagger**:
Sending an offer to its payers one after another with a delay, rather than all at once.
_Avoid_: drip, throttle

**Settled**:
The end of an offer in which the payer paid the bank transfer and the offerer paid them; **canceled** is the other way an offer ends for everyone.
_Avoid_: completed, finished, done

## Sync and devices

**Device**:
One installation of Linky with its own local copy of the user's data.
_Avoid_: client, instance, session

**Evolu relay**:
The server that syncs encrypted data between the user's devices; it never sees plaintext.
_Avoid_: sync server, backend, Evolu server

**Recommended relay**:
A Nostr relay or Evolu relay that linky.fit/recommended-relays lists; every device keeps it configured, and the relays the user added come on top.
_Avoid_: default relay, built-in relay

**Device-local**:
State that stays on one device and never syncs, such as wallet counters.
_Avoid_: local-only, cached

**Scope**:
One kind of synced data with its own storage policy: identity, contacts, messages, wallet or transactions.
_Avoid_: lane, category, bucket

**Shard**:
One bounded slice of a scope's history; writes go to the newest shard and older ones fill no further.
_Avoid_: lane, partition, page

**Rotation**:
Starting a new shard for a scope once the current one is full.
_Avoid_: rollover, split

**Forget**:
Dropping a scope's older shards from a device; messages and transactions can be forgotten, money and contacts never.
_Avoid_: delete, prune, archive

**Inspector**:
The diagnostic timeline of everything a device did: user actions, relay, mint, sync and push traffic.
_Avoid_: debug log, event log
