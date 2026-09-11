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
  "contacts.npubSaved":
    "A Nostr contact was saved after duplicate and active owner limit checks. The contact link identifies the new row.",
  "evolu.ownerRotated":
    "The active write owner moved to the next lane. Previous lanes remain visible for reads; owner links join the rotation to sync diagnostics.",
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
  "bankOffer.staggerExtended":
    "A staggered proxy payment offer reached its next queued recipient: the configured delay elapsed without a winner, so the offer was extended while keeping the original expiry.",
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
  "pay.step":
    "One step of paying a contact with a cashu token sent as a chat message (start, mint-selected, swap-ok, plan-send-token, publish-pending, publish-ok, publish-failed, payment-notice-publish, message-ack, queued-offline). The client and message links tie the steps to the gift wraps they produced.",
  "contacts.addToGroup":
    "User assigned the contacts just saved from a chat message to a group; the payload lists the contact ids and the group name.",
  ChatImageShareFailed:
    "System share of a chat image failed for a reason other than the user cancelling; the app fell back to a file download when triggered from the message menu.",
  "mints.addKnownMint":
    "linkshu recorded a mint in its known-mint set without contacting it. The payload names the mint; repeating the operation leaves one entry.",
  "mints.removeKnownMint":
    "linkshu tried to forget a known mint. MintInUse means unspent proofs still name it; proofCount reports how many. Success removes the seen entry without contacting the mint.",
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
    "A transfer was closed by the app because nothing is left to do about it (a delivered messenger send, a dismissed failed receive). Handed-out proofs stay handed out until the mint reports them spent.",
  ProofsChanged:
    "A batch of stored proofs moved to a new state inside linkshu (e.g. available → spent, (new) → handedOut); the reason names the operation that caused it, the operation link points at the melt or send holding them. Amounts and counts only — the proofs themselves never travel.",
  OperationChanged:
    "A stored operation (melt, topup, autoswap, send, receive) changed status; the reason names what caused it. Follow the operation link to the proofs it holds and the operation rows around it.",
  CounterAdvanced:
    "linkshu moved a deterministic derivation counter (NUT-13) for one mint/unit/keyset — the audit trail for output derivation and collision recovery.",
  QuoteStateChanged:
    "A mint or melt quote was observed in a new state while a linkshu flow (topup, autoswap, melt) watched it; the quote link ties the sequence together. `via` says which watcher saw it — the poll, or a NUT-17 websocket subscription the mint pushed it over.",
  "topup.subscribe":
    "A topup's NUT-17 subscription failed or its socket closed. It will retry with backoff while HTTP polling continues. The quote link connects the retry to settlement; normal cancellation emits no failure.",
  LightningFeeProbed:
    "linkshu measured a mint's Lightning fee by pricing another mint's unpaid invoice as a melt quote. Nothing is paid; links carry both quote ids.",
  "npubCash.upstreamQuotesListed":
    "The wallet asked upstream npub.cash which mint quotes for the user's <npub>@npub.cash address were paid; the payload counts what was listed and what was new. Each new quote is then minted by a linkshu topup.adopt operation sharing its quote link.",
  "melt.resume":
    "linkshu asked the mint about one persisted unsettled melt (a payment that stayed PENDING or whose response was lost). The result says what happened: paid (change reclaimed, reserved inputs dropped), unpaid (inputs back in balance), pending (left alone), or a failure when the mint gave no usable answer. Row and quote links tie it to the original melt.melt and its lifecycle rows.",
  "melt.resumePending":
    "One pass over every persisted unsettled melt, run when the wallet runtime comes up and when the browser comes back online; the payload lists each record's outcome.",
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
