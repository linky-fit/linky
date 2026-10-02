import type { CollectedInspectorRow } from "../inspector/inspectorRows";
import { nostrKindLabel } from "../nostrKindNames";
import { isRecord } from "../../utils/unknown";

// Human vocabulary for inspector rows: per-tag and per-kind explanations shown
// by the inspector UI.

const NOSTR_KIND_EXPLANATIONS: Record<number, string> = {
  0: "Profile metadata: display name, picture, and lightning address.",
  7: "Reaction to a message (emoji) — inside Linky it travels as the rumor of a gift wrap.",
  14: "Unsigned chat message rumor — normally only seen inside a decrypted gift wrap.",
  1059: "NIP-59 gift wrap: an encrypted envelope that hides sender and content. Outer timestamps are randomized up to 2 days back, so inbox sync re-queries a window and the same wraps legitimately reappear.",
  10002:
    "NIP-65 relay list: announces which relays this user writes to and reads from.",
  10050:
    "NIP-17 DM inbox relay list: tells other clients where to deliver gift-wrapped DMs for this user.",
  30315: "NIP-38 user status.",
};

const TAG_DESCRIPTIONS: Record<string, string> = {
  "auth.loggedOut":
    "User confirmed logout. Every open tab reloads and the first one to boot deletes everything the site stored on this device: the Evolu databases, IndexedDB (including this inspector buffer), localStorage, caches and the service worker. The payload says whether Evolu was connected, i.e. whether unsynced data may have been lost.",
  "contacts.npubSaved":
    "A Nostr contact was saved after the duplicate check. The contact link identifies the new row; the insert itself runs in the background.",
  "conversations.archived":
    "User archived a contact's chat: the conversation row (messages scope) records the archive time and its read cursor moves there; the contact row is untouched. The contact and conversation links identify both rows.",
  "conversations.unarchived":
    "A conversation left the archive, either by the user restoring the contact or because an incoming message newer than the archive time arrived.",
  ShardsForgotten:
    "Explicit local forget of old chat shards. Payload lists scope, index and whether owner data was deleted; owner links correlate with shard rotation and subscription rows. Evolu 7 reports deleted: false.",
  ShardsSubscribed:
    "The set of owners this device syncs was reconciled: the app owner plus every visible shard of every scope, at boot, after each rotation and after explicit forgetting. Owner links list the whole set; the payload says why and how many.",
  ShardRotated:
    "A scope's shard pointer moved to a new index, rotated on this device (its writes crossed the byte or mutation rule, or the debug page asked) or on another one. The new shard is subscribed for sync; the owner link is its id.",
  LaneMigrationStarted:
    "First launch on this device after the shard storage update: the old owner lanes are about to be copied into the per-scope shards. Owner links list the legacy lanes read.",
  LaneMigrationScopeIngested:
    "One scope of the lane migration finished: how many rows of each table were copied into the active shard and how many were skipped (a required column missing, a reaction without its message).",
  LaneMigrationDone:
    "The lane migration finished. The payload carries the per-table counts and whether the grace period for older app versions, 180 days from release 26.9.18, is still running.",
  LaneGracePeriodReingestStarted:
    "A later launch inside the grace period: the old lanes are read again so rows written by an older app version reach the shards.",
  LaneGracePeriodReingested:
    "A boot or late-row grace-period re-ingest finished; counts show which lane rows were newer than their shard copies.",
  LaneSpentProofsMirrored:
    "During the migration grace period, spent shard proofs mark their existing legacy copies spent so older devices stop counting them. Owner and proof links identify the copies; no proof secrets are logged.",
  "evolu.legacySpentProofSyncFailed":
    "A terminal proof state could not be mirrored to legacy storage. An older device may show stale funds until its mint check corrects them; the next proof change retries.",
  "evolu.laneMigrationFailed":
    "The lane migration threw before it could finish; the done flag stays unset and the next launch retries. The app keeps running on the lanes meanwhile.",
  EvoluSyncRetry:
    "The user reloads the app to retry Evolu sync after a quota or server configuration change. Local history is preserved.",
  EvoluError:
    "Evolu reported a database or sync error. The owner link identifies the affected sync account when available; relay reachability alone does not confirm its data synced.",
  WirePublished:
    "Outgoing: linkstr signed a gift wrap and handed it to the listed relays; the payload includes per-relay accepted/failed results. One operation usually produces two wraps: a copy for the recipient and a copy for the sender's own devices.",
  WireSubscribed:
    "linkstr opened a live subscription with this filter at the relay; matching events stream in as WireEventReceived rows until it closes.",
  WireEventReceived:
    "An event delivered by a relay on an open subscription, before decryption or routing. Follow its wrap id to see what the inbox made of it.",
  InboxRouted:
    "The inbox decrypted an incoming gift wrap and routed it to an app-level fact (e.g. ReactionAdded) — or dropped it (WrapDropped) when the rumor could not be used, for example an unsupported kind.",
  ChatImageShared:
    "User exported a decrypted chat image through the system share sheet; the rumor link ties it to the message it came from.",
  ChatImageSaved:
    "User saved a decrypted chat image as a file download; the rumor link ties it to the message it came from.",
  ChatFileShared:
    "User exported a decrypted chat PDF through the system share sheet; the rumor link ties it to the message it came from.",
  ChatFileSaved:
    "User saved a decrypted chat PDF as a file download; the rumor link ties it to the message it came from.",
  ChatFileShareFailed:
    "System share of a chat PDF failed for a reason other than the user cancelling; the app fell back to a file download when triggered from the message menu.",
  AppDataExported:
    "User exported contacts and the cashu wallet as a backup file: a browser download on the web, the system share sheet in the native shell. The payload holds counts only, never the rows.",
  AppDataExportFailed:
    "The backup file could not be built or handed to the platform for a reason other than the user dismissing the share sheet.",
  "boltCard.sessionStarted":
    'The Send screen opened with the synced "arm on Send" switch on, so the NFC bolt card is switching on. The device starts connecting to its card bridge and arming NFC at the same time; cardLoadMs is how long reading the card from the native key store took. The boltCardSession link ties every row of this session together.',
  "boltCard.nfcStarted":
    "NFC card emulation is armed and a reader can read the card. msSinceStart measures activation; routingConfirmed is false when Android did not confirm within 3 s that it routes the NDEF application to Linky, so the card may not answer.",
  "boltCard.bridgeReady":
    "The card authenticated on its bridge, which now forwards POS requests. A POS that read the card earlier waits at the bridge for this moment. reconnects counts the attempts it took after a drop.",
  "boltCard.bridgeLost":
    "The connection to the card bridge closed during the session. willReconnect says whether the device tries again; a POS request arriving meanwhile waits at the bridge.",
  "boltCard.tagRead":
    "A reader read the card's NDEF URL. The payload counter is the tap that was read; the device already serves the next one.",
  "boltCard.withdrawAnswered":
    "A POS opened the card URL and the bridge forwarded it. The card either offered a withdraw up to maxWithdrawableSat (spendable balance minus the melt fee reserve) or rejected the tap with the reason the POS shows.",
  "boltCard.invoiceAnswered":
    "A POS sent its invoice to the card's LNURL callback. An accepted invoice ends the session and goes through the scanned-invoice payment path: auto-pay up to the limit, confirmation above it.",
  "boltCard.sessionEnded":
    "The bolt card switched off: after an accepted invoice (paying), when the Send screen closed or the app paused (ended), or on a failure (bridge, NFC, storage).",
  "bankOffer.recipientPinned":
    "Bank details are reserved for this recipient before publishing. Retries keep the same recipient even if delivery acknowledgments are lost or earlier acceptances arrive late.",
  "bankOffer.staggerExtended":
    "A staggered proxy payment offer reached its next queued recipient: the configured delay elapsed without a winner, so the offer was extended while keeping the original expiry.",
  "payment.queuedApprovalRejected":
    "An offline payment had no pinned recipient identity or that identity changed. Its unfunded approval was canceled and its chat placeholder asks for a new approval.",
  "payment.queuedFailed":
    "An offline payment was sent after reconnecting and failed after it may have created a token. It is not retried, so it can never be paid twice; its chat placeholder shows the error.",
  "paymentRequest.authorizationLost":
    "The reviewed request or approved recipient changed during token creation. Delivery was stopped and the app attempted to return the pending transfer to the wallet; a failed return leaves it recoverable.",
  "paymentRequest.editRejected":
    "An incoming edit tried to create or change a payment request. Payment requests are immutable; the sender must send a new request.",
  "bankOffer.snapshotNotAuthorized":
    "A bank-offer snapshot was rejected or held for an authenticated offerer snapshot. It cannot update the offer or authorize settlement yet.",
  "bankOffer.staggerDropped":
    "The queued recipients of a staggered proxy payment offer were discarded because the offer stopped being open — someone accepted it, it ended, or it expired.",
  "profiles.searchProfiles":
    "Add-contact text search: a NIP-50 kind-0 query fanned out to the read relays plus the configured search relays; relays without NIP-50 answer with unrelated profiles, so only hits that match the query locally are returned (the params carry the query and limit).",
  "contacts.dedupeFailed":
    "The contact dedupe the user started threw before finishing; the payload carries the error. Contacts already merged before the failure stay merged.",
  "contacts.ownerMigrated":
    "One-time move of legacy contact rows into the app owner lane after a seed login; the payload counts the rows that were rewritten and those that failed.",
  "profileShare.tiltOpened":
    "The phone was held with the top of the screen pointing down, so the full-screen contact card opened for the person facing it. It closes on tap or when the phone comes back upright.",
  "profileShare.tiltSettingChanged":
    "The user toggled tilt to show profile in Settings. Enabling waits for motion permission; denial or a failed request leaves it off. The payload records the resulting setting and permission outcome.",
  "lnurlAuth.requested":
    "A scanned LUD-04 login request was recognized and put in front of the user; nothing is signed and no key is derived until they approve it. The challenge link ties it to the approval or failure that follows.",
  "lnurlAuth.approved":
    "The user approved an LNURL-auth request and the domain confirmed the login. Linky signed the challenge with a linking key derived per domain from the active Nostr key; the session itself lives at the domain, not in the app.",
  "lnurlAuth.failed":
    "An approved LNURL-auth request did not end in a confirmed login — the domain rejected it (expired challenge, unknown key), answered with something other than OK, or the callback never completed. The payload carries the reason shown to the user.",
  "relayList.publishFailed":
    "Publishing the user's NIP-65 / NIP-17 relay lists after an add or remove failed; the local list was already updated, so the relays are out of sync until the next successful publish.",
  "relayList.syncFailed":
    "Fetching the user's relay lists from the relays at startup failed; the app keeps using its cached list.",
  "evolu.serversChanged":
    "The user changed the Evolu server list. The payload records the saved configured and enabled servers, including an empty selection. A reload applies the new transports.",
  "evolu.linkyRelayMigrated":
    "The one-time upgrade enabled the Linky Evolu relay before database startup, preserving the other configured servers and their disabled states.",
  "recommendedRelays.fetched":
    "The app fetched linky.fit/recommended-relays (at launch and once a day). Nostr relays apply right away; Evolu relays apply on the next launch. The payload lists the recommendation and the Nostr relays it dropped, which leave the relay lists too.",
  "recommendedRelays.fetchFailed":
    "Fetching linky.fit/recommended-relays failed; the app keeps using the last fetched recommendation, or the one bundled with the build.",
  "relayList.reconciled":
    "The fetched Nostr relay lists lacked a recommended relay, still carried a dropped one, or the two lists disagreed, so the app published both with the recommended relays plus the user's own. Event links identify the signed list publications; a failed publish retries after 30 seconds.",
  "evolu.userServersMigrated":
    "The one-time upgrade kept every previously configured Evolu relay that is not recommended as one the user added. It runs before database startup; the payload records the old stored list and whether the old built-in defaults applied.",
  "relayList.linkyRelayMigrated":
    "The one-time upgrade published both Nostr relay lists with the Linky relay added. Event links identify the signed list publications; failed attempts remain pending for retry.",
  "pay.step":
    "One step of paying a contact with a cashu token sent as a chat message (start, mint-selected, swap-ok, plan-send-token, publish-pending, publish-ok, publish-failed, payment-notice-publish, message-ack, queued-offline). The client and message links tie the steps to the gift wraps they produced.",
  "contacts.addToGroup":
    "User assigned the contacts just saved from a chat message to a group; the payload lists the contact ids and the group name.",
  ChatImageShareFailed:
    "System share of a chat image failed for a reason other than the user cancelling; the app fell back to a file download when triggered from the message menu.",
  "mints.addKnownMint":
    "linkshu recorded a mint in its known-mint set without contacting it. The payload names the mint; repeating the operation leaves one entry.",
  "mints.removeKnownMint":
    "linkshu tried to forget a known mint. MintInUse means unspent proofs or pending deferred receives still name it; proofCount and deferredReceiveCount report how many. Success removes the seen entry without contacting the mint.",
  "validation.inspectProofStates":
    "Read-only mint status check for the token list or detail. Reports the mint's answer (unspent, pending, spent, unknown) per stored proof without exposing secrets.",
  "validation.checkTransfer":
    "NUT-07 check of one transfer: a send's handed-out proofs, or the proofs a received token text carries. A send whose proofs are all spent closes as claimed.",
  "tokens.importProofs":
    "Backup proofs were restored in their recorded state without contacting the mint; secrets already in the inventory were skipped. The result counts what was added.",
  "tokens.importOperation":
    "A backup operation was restored as-is; an existing operation with the same key was replaced.",
  "tokens.ingestLegacyRows":
    "Rows of the legacy cashuToken table were carried into the proof inventory: accepted → available, reserved → held, issued/externalized → a send transfer with handed-out proofs, error → spent only when the recorded error says so. Rows whose proofs are already stored are skipped.",
  "tokens.forget":
    "A transfer was closed by the app because nothing is left to do about it (a delivered messenger send, a dismissed failed receive, a deferred receive the user discarded). Handed-out proofs stay handed out until the mint reports them spent; a discarded deferral's token is gone unless the user kept its text. Discarding a deferral a resume pass already handed to its receive fails with InvalidTransferTransition.",
  "restore.restore":
    "Seed scan for proofs not already in the inventory. Missing-token recovery follows this with tokens.reclaim for only the newly discovered proofs; ordinary restore keeps them as-is.",
  "tokens.reclaim":
    "Selected stored proofs were checked and re-signed at their mints. Reports reclaimed, already spent, and unresolved proof ids; pending and held proofs remain untouched. Fresh proofs are stored before old copies are marked spent.",
  "tokens.reclaimMint":
    "One mint's part of a bulk reclaim. Proof ids identify the selected inputs; a successful result is the net amount returned after mint fees. A failed attempt leaves unconfirmed inputs for retry.",
  ProofsChanged:
    "A batch of stored proofs moved to a new state inside linkshu (e.g. available → spent, (new) → handedOut); the reason names the operation that caused it, the operation link points at the melt or send holding them. Amounts and counts only — the proofs themselves never travel.",
  OperationChanged:
    "A stored operation (melt, topup, autoswap, send, receive, deferredReceive) changed status; the reason names what caused it. Follow the operation link to the proofs it holds and the operation rows around it.",
  CounterAdvanced:
    "linkshu moved a deterministic derivation counter (NUT-13) for one mint/unit/keyset — the audit trail for output derivation and collision recovery.",
  QuoteStateChanged:
    "A mint or melt quote was observed in a new state while a linkshu flow (topup, autoswap, melt) watched it; the quote link ties the sequence together. `via` says which watcher saw it — the poll, or a NUT-17 websocket subscription the mint pushed it over.",
  "topup.subscribe":
    "A topup's NUT-17 subscription failed or its socket closed. It will retry with backoff while HTTP polling continues. The quote link connects the retry to settlement; normal cancellation emits no failure.",
  "autoswap.estimate":
    "linkshu priced moving an amount between mints: a mint quote at the target and a melt quote for its invoice at the source, plus the source's input fee allowance. Nothing is paid; both quotes expire unused. A following autoswap.claim with the same mints performs the move.",
  "settings.boltCardArmOnSend":
    'The user switched the synced "arm on Send" bolt card setting. On makes the Send screen arm NFC card emulation on every Android device with NFC; unset counts as off.',
  "settings.allowTestMints":
    'The user switched the synced "Allow test mints" setting. Off hides test-mint balances, mint lists and chat tokens and refuses new test-mint tokens; stored test-mint proofs stay untouched.',
  "settings.displayCurrencies":
    "The user enabled or disabled a display currency in Settings. The list is a synced setting, so other devices follow it; which enabled currency is shown stays per device.",
  LightningFeeProbed:
    "linkshu measured a mint's Lightning fee by pricing another mint's unpaid invoice as a melt quote. Nothing is paid; links carry both quote ids.",
  "npubCash.claimsUnsaved":
    "Storage refused to keep tokens Linky's npub.cash server had just handed out, each only once. They are held in memory for this session and received at once; while one is neither saved nor received, the user is asked to copy it.",
  "npubCash.upstreamQuotesListed":
    "The wallet asked upstream npub.cash which mint quotes for the user's <npub>@npub.cash address were paid; the payload counts what was listed and what was new. Each new quote is then minted by a linkshu topup.adopt operation sharing its quote link.",
  "melt.resume":
    "linkshu asked the mint about one persisted unsettled melt (a payment that stayed PENDING or whose response was lost). The result says what happened: paid (change reclaimed, reserved inputs dropped), unpaid (inputs back in balance), pending (left alone), or a failure when the mint gave no usable answer. Row and quote links tie it to the original melt.melt and its lifecycle rows.",
  "melt.resumePending":
    "One pass over every persisted unsettled melt, run when the wallet runtime comes up and when the browser comes back online; the payload lists each record's outcome.",
  "receive.resume":
    "linkshu retried one token kept because its mint could not be loaded or asked (a deferredReceive). A result with status received means it landed in the balance; status pending means the mint still cannot be used: nothing was written and the token stays kept. TokenAlreadyKnown, a TokenAlreadySpent from the state check, AmountConsumedByFee or TokenParseFailed close the deferral. A MintUnreachable, MintRejected or TokenAlreadySpent from the swap means the receive was already written: the deferral closed and the failed receive carries the token from here, retried quietly at the next launch when the failure was transient.",
  "receive.resumeDeferred":
    "One pass over every kept token whose mint could not be used, run when the wallet runtime comes up, when the browser comes back online, and on a backoff while tokens wait; the payload lists each deferral's outcome (received, closed, failed when its swap failed and a failed receive took it over, pending when the mint still cannot be used).",
  "receive.resumeDeferredRejected":
    "A receive.resumeDeferred pass ended with an error instead of a result, usually because the wallet runtime shut down mid-pass. Nothing about the kept tokens changed beyond what earlier rows show; the next pass retries them.",
  "melt.historyResolved":
    "The app updated a pending Lightning payment in the transaction history after melt.resume settled it — to paid (amount and fee) or failed. The quote link connects it to the melt rows.",
  "send.rowForgotten":
    "The app dropped a pending send row because its token verifiably reached the recipient (chat message published, or payment request POSTed). Follow the row link back to the send.send operation that produced it.",
};

const describeTag = (row: CollectedInspectorRow): string => {
  const known = TAG_DESCRIPTIONS[row.tag];
  if (known) return known;
  return `An inspector event tagged "${row.tag}" on the "${row.channel}" channel. Rows sharing any of its link ids are related.`;
};

const MAX_KIND_SCAN_DEPTH = 4;

// Payload shapes are linkstr's, not ours; a shallow key scan finds kind
// numbers wherever they sit (event.kind, wrap.kind, filter.kinds, …).
const scanForKinds = (
  value: unknown,
  depth: number,
  out: Set<number>,
): void => {
  if (depth > MAX_KIND_SCAN_DEPTH) return;
  if (Array.isArray(value)) {
    for (const entry of value) scanForKinds(entry, depth + 1, out);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "kind" && typeof entry === "number") {
      out.add(entry);
    } else if (key === "kinds" && Array.isArray(entry)) {
      for (const kind of entry) {
        if (typeof kind === "number") out.add(kind);
      }
    } else {
      scanForKinds(entry, depth + 1, out);
    }
  }
};

const collectNostrKinds = (payload: unknown): number[] => {
  const kinds = new Set<number>();
  scanForKinds(payload, 0, kinds);
  return [...kinds].sort((left, right) => left - right);
};

export const describeInspectorRow = (row: CollectedInspectorRow): string => {
  const kindLines = (
    row.channel.startsWith("nostr.") ? collectNostrKinds(row.payload) : []
  )
    .map((kind) => {
      const explanation = NOSTR_KIND_EXPLANATIONS[kind];
      return explanation ? `${nostrKindLabel(kind)}: ${explanation}` : null;
    })
    .filter((line): line is string => line !== null);
  const kindsBlock = kindLines.length > 0 ? `\n\n${kindLines.join("\n")}` : "";
  return `${describeTag(row)}${kindsBlock}`;
};
