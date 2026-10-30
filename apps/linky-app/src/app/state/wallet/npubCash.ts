import { transactionIdForOperation } from "@linky-fit/linksync";
import type { KeyValueStorage } from "@linky-fit/linksync/evolu";
import { parseTokenText, type OperationId } from "@linky-fit/linkshu";
import {
  decodeNsec,
  makeNip98AuthHeader,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { Result, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { getInspectorEmissionEnabled } from "../../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../../devtools/inspector/reportInspectorRows";
import { JsonValue } from "../../../types/json";
import {
  LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX,
  LOCAL_NPUB_CASH_UPSTREAM_QUOTES_STORAGE_KEY_PREFIX,
} from "../../../utils/constants";
import { isHiddenTestMint, normalizeMintUrl } from "../../../utils/mint";
import {
  addToClaimInbox,
  readClaimInbox,
  removeFromClaimInbox,
} from "../../../utils/npubCashClaimInbox";
import { extractUniqueClaimTokens } from "../../../utils/npubCashClaimResponse";
import {
  isNpubCashDisabled,
  NPUB_CASH_REQUEST_TIMEOUT_MS,
  NPUB_CASH_SERVER_BASE_URL,
  NPUB_CASH_UPSTREAM_BASE_URL,
} from "../../../utils/npubCashServer";
import {
  isUpstreamQuoteSettled,
  listUpstreamPaidQuotes,
  parseUpstreamQuoteLedger,
  settleUpstreamQuotes,
  type SettledUpstreamQuote,
  type UpstreamPaidQuote,
  type UpstreamPaidQuotesListing,
} from "../../../utils/npubCashUpstreamQuotes";
import { withTabLockIfFree } from "../../../utils/storage";
import { nowSeconds } from "../../../utils/time";
import { getUnknownErrorMessage } from "../../../utils/unknown";
import { describeTaggedCashuError } from "../../lib/cashuStoredError";
import { readCashuTokenMemo } from "../../lib/tokenMessageInfo";
import type { PaymentTelemetryMethod } from "../../types/appTypes";
import { linkshuCommandsAtom, type LinkshuCommands } from "../linkshu/commands";
import { platformAtom } from "../platform";
import { allowTestMintsAtom } from "../session/settings";
import { currentNpubAtom, currentNsecAtom } from "../session/session";
import { walletOpRunningAtom, walletOpsAtom, type WalletOps } from "./opQueue";
import { ownerStorageAtom } from "./ownerStorage";
import { paymentLogAtom, type PaymentLog } from "./paymentLog";

const CLAIM_IDLE_MIN_INTERVAL_MS = 25_000;
const CLAIM_TOPUP_MIN_INTERVAL_MS = 5_000;
const CLAIM_LOCK_TTL_MS = 20_000;

/** A payment to the user's lightning address, received into the wallet. */
export interface NpubCashReceived {
  readonly amount: number;
  readonly mint: string;
  readonly operationId: OperationId;
  readonly method: PaymentTelemetryMethod;
  /** Token texts the wallet now knows, to hide them from chat auto-claims. */
  readonly knownTokens: ReadonlyArray<string>;
}

/** What one claim reports while it runs; the adapter turns it into UI. */
export interface NpubCashClaimEvents {
  readonly onReceived: (payment: NpubCashReceived) => void;
  readonly onReceiveFailed: (detail: string) => void;
  /** A token storage refused and the wallet could not receive yet; offered once per token. */
  readonly onUnsaved: (token: string) => void;
}

export interface NpubCashCommands {
  /**
   * Collects payments made to the user's lightning addresses, on both hosts
   * that resolve the same npub: Linky's own server hands proofs over as
   * tokens (received like a pasted token), upstream npub.cash only lists
   * paid mint quotes, which linkshu adopts on upstream's mint. Runs in one
   * tab at a time, at most every 25 s (5 s while `fast`), and never while
   * another wallet operation runs. Claimed tokens wait in a device-local
   * inbox until linkshu holds or settles them; upstream quotes stay listed
   * until adopted; the next poll retries both.
   */
  readonly claim: (
    options: { readonly fast: boolean },
    events: NpubCashClaimEvents,
  ) => Promise<void>;
}

/** A NIP-98 header for an npub.cash call, signed with the session's nostr key. */
export const makeNpubCashAuthHeader = async (
  nsec: string | null,
  url: string,
  method: string,
  payload?: Record<string, string>,
): Promise<string> => {
  if (!nsec) throw new Error("Missing nsec");
  const secretKey = decodeNsec(nsec);
  if (!secretKey) throw new Error("Invalid nsec");
  return makeNip98AuthHeader(
    payload === undefined ? { url, method } : { url, method, payload },
    secretKey,
    UnixSeconds.make(nowSeconds()),
  );
};

/** Stores the default mint at npub.cash; rejects when the server refuses it. */
export const updateNpubCashMint = async ({
  currentNpub,
  currentNsec,
  mint,
}: {
  readonly currentNpub: string | null;
  readonly currentNsec: string | null;
  readonly mint: string;
}): Promise<void> => {
  if (isNpubCashDisabled()) return;
  if (!currentNpub) throw new Error("Missing npub");
  if (!currentNsec) throw new Error("Missing nsec");
  const cleaned = normalizeMintUrl(mint);
  if (!cleaned) return;
  const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/info/mint`;
  const payload = { mintUrl: cleaned };
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: await makeNpubCashAuthHeader(
        currentNsec,
        url,
        "PUT",
        payload,
      ),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("npub.cash mint update failed");
};

/** The user's npub.cash profile JSON, or null when the server did not answer it. */
export const fetchNpubCashInfo = async (
  currentNsec: string | null,
  signal: AbortSignal,
): Promise<JsonValue | null> => {
  const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/info`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: await makeNpubCashAuthHeader(currentNsec, url, "GET"),
    },
    signal,
  });
  if (!response.ok) return null;
  return Schema.decodeUnknownSync(JsonValue)(await response.json());
};

const reportClaimsUnsaved = (count: number): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "npubCash.claimsUnsaved",
      summary: `storage refused ${count} claimed npub.cash tokens; kept for this session only`,
      links: {},
      context: { server: NPUB_CASH_SERVER_BASE_URL },
      payload: { count },
    },
  ]);
};

const reportUpstreamQuotesListed = (
  listing: UpstreamPaidQuotesListing,
  fresh: readonly UpstreamPaidQuote[],
  since: number | null,
): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "cashu",
      tag: "npubCash.upstreamQuotesListed",
      summary: `npub.cash lists ${listing.paid.length} paid quotes, ${fresh.length} new`,
      links: { quote: fresh.map((quote) => quote.quoteId) },
      context: { server: NPUB_CASH_UPSTREAM_BASE_URL },
      payload: {
        since,
        complete: listing.complete,
        paid: listing.paid.length,
        fresh: fresh.map(({ quoteId, mint, amountSat, locked }) => ({
          quoteId,
          mint,
          amountSat,
          locked,
        })),
      },
    },
  ]);
};

/** Claim state of the page: tokens kept only in memory, and whether a claim runs. */
/** The default mint npub.cash last accepted from this device, so a choice is sent there once. */
export const npubCashSyncedMintAtom = Atom.keepAlive(
  Atom.make<string | null>(null),
);

export interface NpubCashSession {
  inFlight: boolean;
  unsaved: ReadonlyArray<string>;
  readonly offeredCopies: Set<string>;
}

export const makeNpubCashSession = (): NpubCashSession => ({
  inFlight: false,
  unsaved: [],
  offeredCopies: new Set(),
});

// One per page: rebuilding the commands must not drop tokens storage refused.
const npubCashSessionAtom = Atom.keepAlive(
  Atom.readable(() => makeNpubCashSession()),
);

export interface NpubCashDeps {
  readonly allowTestMints: boolean;
  readonly currentNpub: string | null;
  readonly currentNsec: string | null;
  readonly isWalletBusy: () => boolean;
  readonly kv: KeyValueStorage;
  readonly linkshu: Pick<
    LinkshuCommands,
    "adoptPaidCashuQuote" | "receiveCashuToken"
  >;
  readonly logPaymentEvent: PaymentLog["logPaymentEvent"];
  readonly ops: Pick<WalletOps, "runQueuedTask">;
  readonly ownerKey: (prefix: string) => string;
  readonly session: NpubCashSession;
}

export const makeNpubCashCommands = (deps: NpubCashDeps): NpubCashCommands => {
  const { kv, linkshu, logPaymentEvent, ops, ownerKey, session } = deps;
  const authHeader = (
    url: string,
    method: string,
    payload?: Record<string, string>,
  ) => makeNpubCashAuthHeader(deps.currentNsec, url, method, payload);

  const logReceived = (
    payment: NpubCashReceived & {
      readonly unit: string | null;
      readonly note?: string | null;
      readonly details?: JsonValue;
    },
  ) =>
    logPaymentEvent({
      direction: "in",
      status: "ok",
      transactionId: transactionIdForOperation(payment.operationId),
      amount: payment.amount,
      fee: null,
      mint: payment.mint,
      unit: payment.unit,
      error: null,
      contactId: null,
      method: payment.method,
      note: payment.note ?? null,
      paymentType: "received_lightning",
      phase: "receive",
      ...(payment.details === undefined ? {} : { details: payment.details }),
    });

  /** True once the token needs no copy here: received, kept by linkshu or refused for good. */
  const receiveClaimedToken = async (
    tokenText: string,
    events: NpubCashClaimEvents,
  ): Promise<boolean> => {
    const tokenRaw = tokenText.trim();
    if (!tokenRaw) return true;
    const parsed = parseTokenText(tokenRaw);
    const logFailure = (message: string): void =>
      logPaymentEvent({
        direction: "in",
        status: "error",
        amount: parsed?.amount ?? null,
        fee: null,
        mint: parsed?.mint ?? null,
        unit: null,
        error: message,
        contactId: null,
        method: "cashu_receive",
        paymentType: "received_lightning",
        phase: "receive",
      });
    return ops.runQueuedTask(async () => {
      try {
        // Left in the inbox: turning test mints back on receives it.
        if (isHiddenTestMint(parsed?.mint ?? null, deps.allowTestMints))
          return false;
        const outcome = await linkshu.receiveCashuToken(tokenRaw, {
          automatic: true,
        });
        if (Result.isFailure(outcome)) {
          const error = outcome.failure;
          // A receive that waited out another one's turn wrote nothing.
          if (error._tag === "CounterLockTimeout") return false;
          // A deferred token is kept by linkshu and received on a later retry.
          if (
            error._tag === "TokenAlreadyKnown" ||
            error._tag === "ReceiveDeferred"
          )
            return true;
          const message = describeTaggedCashuError(error) ?? error._tag;
          logFailure(message);
          events.onReceiveFailed(message);
          return true;
        }
        const receipt = outcome.success;
        const payment = {
          amount: receipt.amount,
          mint: receipt.mint,
          operationId: receipt.operationId,
          method: "cashu_receive",
          knownTokens: [tokenRaw, receipt.tokenText],
        } as const;
        logReceived({
          ...payment,
          unit: receipt.unit,
          note: readCashuTokenMemo(receipt.tokenText),
        });
        events.onReceived(payment);
        return true;
      } catch (error) {
        const message = getUnknownErrorMessage(error, "Accept failed");
        logFailure(message);
        events.onReceiveFailed(message);
        return false;
      }
    });
  };

  /** Lets go of each token linkshu now holds or settled. */
  const receiveClaims = async (
    inboxKey: string,
    tokens: readonly string[],
    events: NpubCashClaimEvents,
  ) => {
    for (const tokenText of tokens) {
      if (await receiveClaimedToken(tokenText, events)) {
        removeFromClaimInbox(inboxKey, tokenText);
        session.unsaved = session.unsaved.filter(
          (unsaved) => unsaved !== tokenText,
        );
      } else if (
        session.unsaved.includes(tokenText) &&
        !session.offeredCopies.has(tokenText)
      ) {
        session.offeredCopies.add(tokenText);
        events.onUnsaved(tokenText);
      }
    }
  };

  const claimFromLinkyServer = async (): Promise<readonly string[]> => {
    const url = `${NPUB_CASH_SERVER_BASE_URL}/api/v1/claim`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: await authHeader(url, "GET") },
      signal: AbortSignal.timeout(NPUB_CASH_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    return extractUniqueClaimTokens(
      Schema.decodeUnknownSync(JsonValue)(await response.json()),
    );
  };

  /** Saved claims are received before the server is asked, so a stalled request never holds them back. */
  const collectFromLinkyServer = async (events: NpubCashClaimEvents) => {
    const inboxKey = ownerKey(LOCAL_NPUB_CASH_CLAIM_INBOX_STORAGE_KEY_PREFIX);
    session.unsaved = addToClaimInbox(inboxKey, session.unsaved);
    await receiveClaims(
      inboxKey,
      [...readClaimInbox(inboxKey), ...session.unsaved],
      events,
    );

    const claimed = await claimFromLinkyServer();
    const refused = addToClaimInbox(inboxKey, claimed);
    if (refused.length > 0) {
      reportClaimsUnsaved(refused.length);
      session.unsaved = [
        ...session.unsaved,
        ...refused.filter((token) => !session.unsaved.includes(token)),
      ];
    }
    await receiveClaims(inboxKey, claimed, events);
  };

  /**
   * One quote at a time through the wallet queue. A definitive answer —
   * minted, minted elsewhere, or rejected by the mint — settles the quote in
   * the ledger; a transient one leaves it for the next sweep.
   */
  const adoptUpstreamQuote = async (
    quote: UpstreamPaidQuote,
    events: NpubCashClaimEvents,
  ): Promise<boolean> => {
    // Left in the ledger: turning test mints back on adopts it.
    if (isHiddenTestMint(quote.mint, deps.allowTestMints)) return false;
    const outcome = await ops.runQueuedTask(() =>
      linkshu.adoptPaidCashuQuote({
        mint: quote.mint,
        quoteId: quote.quoteId,
        amountSat: quote.amountSat,
        invoice: quote.invoice,
        expiresAt: quote.expiresAt,
        locked: quote.locked,
      }),
    );
    if (Result.isSuccess(outcome)) {
      const receipt = outcome.success;
      const payment = {
        amount: receipt.amount,
        mint: receipt.mint,
        operationId: receipt.operationId,
        method: "lightning_address",
        knownTokens: [receipt.tokenText],
      } as const;
      logReceived({
        ...payment,
        unit: "sat",
        details: { lightningInvoice: quote.invoice, quoteId: quote.quoteId },
      });
      events.onReceived(payment);
      return true;
    }
    const error = outcome.failure;
    if (error._tag === "QuoteAlreadyIssued") return true;
    const definitive = error._tag === "MintRejected";
    logPaymentEvent({
      direction: "in",
      status: "error",
      amount: quote.amountSat,
      fee: null,
      mint: quote.mint,
      unit: "sat",
      error: describeTaggedCashuError(error) ?? error._tag,
      contactId: null,
      method: "lightning_address",
      paymentType: "received_lightning",
      phase: "receive",
      details: { quoteId: quote.quoteId, retry: !definitive },
    });
    return definitive;
  };

  const sweepUpstreamPaidQuotes = async (events: NpubCashClaimEvents) => {
    const ledgerKey = ownerKey(
      LOCAL_NPUB_CASH_UPSTREAM_QUOTES_STORAGE_KEY_PREFIX,
    );
    const ledger = parseUpstreamQuoteLedger(kv.getItem(ledgerKey));
    const listing = await listUpstreamPaidQuotes({
      baseUrl: NPUB_CASH_UPSTREAM_BASE_URL,
      since: ledger.since,
      makeNip98AuthHeader: authHeader,
    });
    if (listing === null) return;
    const fresh = listing.paid.filter(
      (quote) => !isUpstreamQuoteSettled(ledger, quote.quoteId),
    );
    reportUpstreamQuotesListed(listing, fresh, ledger.since);
    const settled: SettledUpstreamQuote[] = [];
    for (const quote of fresh) {
      if (await adoptUpstreamQuote(quote, events)) settled.push(quote);
    }
    kv.setItem(
      ledgerKey,
      JSON.stringify(settleUpstreamQuotes(ledger, settled, listing.complete)),
    );
  };

  return {
    claim: async ({ fast }, events) => {
      // Not while paying or receiving: a claim response consumed then could
      // skip its tokens.
      if (isNpubCashDisabled() || deps.isWalletBusy()) return;
      if (!deps.currentNpub || !deps.currentNsec || session.inFlight) return;
      try {
        await withTabLockIfFree({
          key: ownerKey(LOCAL_NPUB_CASH_CLAIM_LOCK_STORAGE_KEY_PREFIX),
          ttlMs: CLAIM_LOCK_TTL_MS,
          fn: async () => {
            if (session.inFlight) return;
            const lastAttemptKey = ownerKey(
              LOCAL_NPUB_CASH_CLAIM_LAST_ATTEMPT_STORAGE_KEY_PREFIX,
            );
            const lastAttemptMs = Number(kv.getItem(lastAttemptKey));
            const nowMs = Date.now();
            const minIntervalMs = fast
              ? CLAIM_TOPUP_MIN_INTERVAL_MS
              : CLAIM_IDLE_MIN_INTERVAL_MS;
            if (
              Number.isFinite(lastAttemptMs) &&
              lastAttemptMs > 0 &&
              nowMs - lastAttemptMs < minIntervalMs
            )
              return;
            kv.setItem(lastAttemptKey, String(nowMs));

            session.inFlight = true;
            try {
              // Each host on its own: one being down must not starve the other.
              for (const collect of [
                collectFromLinkyServer,
                sweepUpstreamPaidQuotes,
              ]) {
                try {
                  await collect(events);
                } catch (error) {
                  console.warn("[linky][npubcash] collect failed", error);
                }
              }
            } finally {
              session.inFlight = false;
            }
          },
        });
      } catch {
        // A lock or storage failure skips this poll; the next one retries.
      }
    },
  };
};

/** npub.cash over the session's identity, the linkshu runtime and the wallet queue. */
export const npubCashCommandsAtom = Atom.readable((get) =>
  AsyncResult.map(
    AsyncResult.all({
      linkshu: get(linkshuCommandsAtom),
      paymentLog: get(paymentLogAtom),
      storage: get(ownerStorageAtom),
    }),
    ({ linkshu, paymentLog, storage }) =>
      makeNpubCashCommands({
        allowTestMints: get(allowTestMintsAtom),
        currentNpub: get(currentNpubAtom),
        currentNsec: get(currentNsecAtom),
        isWalletBusy: () => get.registry.get(walletOpRunningAtom),
        kv: get(platformAtom).kv,
        linkshu,
        logPaymentEvent: paymentLog.logPaymentEvent,
        ops: get(walletOpsAtom),
        ownerKey: storage.key,
        session: get(npubCashSessionAtom),
      }),
  ),
);
