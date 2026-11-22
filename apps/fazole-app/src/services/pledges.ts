import type { TransactionId } from "@linky-fit/domain";
import {
  Amount,
  Envelope,
  EnvelopeKey,
  EnvelopeOpenDraft,
  EnvelopeRef,
  EnvelopeSendDraft,
  OperationId,
  parseMintUrl,
  type EnvelopeStatus,
  type MintUrl,
} from "@linky-fit/linkshu";
import {
  ClientId,
  decodeNpub,
  encodeNpub,
  MessageText,
  type Pubkey,
} from "@linky-fit/linkstr";
import { createId, transactionIdForOperation } from "@linky-fit/linksync";
import type { LiveSource } from "@linky-fit/linksync/react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { Effect, Result } from "effect";
import {
  CzkAmount,
  FORWARD_RETRY_SEC,
  inflowMint,
  inflowRate,
  isEnvelopeForPledge,
  isPledgeSettled,
  planForward,
  pledgeEnvelopeKey,
  pledgeOpenedMessage,
  pledgeRemainingCzk,
  pledgeRepaymentMessage,
  repaymentCzkFor,
  swapFeeFor,
  unforwardedInflows,
  type Pledge,
  type WalletActivity,
  type Withdrawal,
} from "../domain";
import type { Ledger } from "../storage/ledger";
import { readPledge, savePledge } from "../storage/pledgeSetting";
import type { SettingsRepository } from "../storage/shop";
import type { FazoleRecords } from "../storage/transactions";
import { nowSeconds } from "../utils/time";
import type { ResolvedContact } from "./contacts";
import type { Nostr } from "./nostr";
import { exclusive } from "./serial";
import type { Wallet } from "./wallet";

const PLEDGE_REF = "fazole.pledge:";
const PLEDGE_TOKEN_REF = "fazole.pledge-token:";
// Long enough for the winning terminal to write its withdrawal and deliver before another takes over.
const PENDING_RESUME_GRACE_SEC = 30;
// Short retry when another tab on this device holds the envelope lease.
const BUSY_RETRY_SEC = 5;

const tokenRefOf = (withdrawalId: TransactionId) =>
  `${PLEDGE_TOKEN_REF}${withdrawalId}`;

// Keyed by the envelope's operation id (unique per mint + proofs) so retries of
// the same envelope deduplicate in Linky, while distinct envelopes on different
// mints never collide on clientId.
const pledgeClientId = (
  kind: "token" | "text",
  operationId: string,
): ClientId =>
  ClientId.make(
    bytesToHex(
      sha256(utf8ToBytes(`fazole:pledge:${kind}:${operationId}`)),
    ).slice(0, 32),
  );

interface ResolvedEnvelope {
  readonly outcome: "created" | "adopted";
  readonly operationId: OperationId;
  readonly amount: number;
  readonly status: EnvelopeStatus;
}

type ForwardOutcome = "done" | "continue" | "stop";

/**
 * Cash taken from a Linky user against the bitcoin the shop will receive:
 * while a pledge is open, every inflow is forwarded to them as a Linky
 * token until the CZK amount is repaid, and they get a chat message at
 * each step. Each inflow uses its own deterministic linkshu envelope at its
 * mint so concurrent terminals never forward the same payment twice.
 * The merchant owes one person at a time.
 */
export interface Pledges {
  /** The open pledge; `null` while there is none. */
  readonly current: () => Promise<Pledge | null>;
  /** Opens a pledge and tells the pledger; rejects while another is open. */
  readonly open: (
    contact: ResolvedContact,
    amountCzk: CzkAmount,
  ) => Promise<Pledge>;
  /**
   * Forwards what reached the wallet since the pledge, resumes interrupted
   * deliveries and closes a repaid pledge; idempotent, so it runs on every
   * change. Needs the rate: without one inflows without a stored rate wait.
   */
  readonly reconcile: () => Promise<void>;
  readonly live: LiveSource<Pledge | null>;
  /** Drops a retry waiting for its time. */
  readonly stop: () => void;
}

export const createPledges = ({
  ledger,
  settings,
  nostr,
  wallet,
  czkPerBtc,
  whenHydrated,
}: {
  readonly ledger: Ledger;
  readonly settings: SettingsRepository;
  readonly nostr: Nostr;
  readonly wallet: Wallet;
  readonly czkPerBtc: () => Promise<number | null>;
  /** Resolves once background writes may run. */
  readonly whenHydrated: () => Promise<void>;
}): Pledges => {
  const serially = exclusive();
  const retryAfterSec = new Map<string, number>();
  /** When this terminal first adopted an unrecorded envelope; waits grace before taking over. */
  const adoptedAtSec = new Map<string, number>();
  let retryAtMs: number | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRetry = (delaySec: number = FORWARD_RETRY_SEC) => {
    const delayMs = Math.max(1, delaySec) * 1000;
    const targetMs = Date.now() + delayMs;
    if (retryAtMs !== null && retryAtMs <= targetMs) return;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryAtMs = targetMs;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      retryAtMs = null;
      void reconcile();
    }, delayMs);
  };

  const backoffInflow = (inflowId: string, delaySec = FORWARD_RETRY_SEC) => {
    retryAfterSec.set(inflowId, nowSeconds() + delaySec);
    scheduleRetry(delaySec);
  };

  const current = () => Effect.runPromise(readPledge(settings));
  const save = (pledge: Pledge | null) =>
    Effect.runPromise(savePledge(settings, pledge));

  const tell = async (to: Pubkey, text: string, clientId: ClientId) => {
    await nostr.sendText(
      to,
      MessageText.make(text),
      clientId,
      `${PLEDGE_REF}${clientId}`,
    );
  };

  /**
   * Queues the token to the withdrawal's stored target and (when the row
   * belongs to the open pledge) the repayment chat message under deterministic
   * client ids derived from its operation id.
   */
  const deliverRepayment = async (
    pledge: Pledge | null,
    withdrawal: Withdrawal,
    tokenText: string,
    operationId: string,
  ): Promise<boolean> => {
    const to = decodeNpub(withdrawal.target);
    if (to === null) return false;
    const tokenRef = tokenRefOf(withdrawal.id);
    if (!(await nostr.queuedRefs()).has(tokenRef)) {
      try {
        await nostr.sendToken(
          to,
          tokenText,
          tokenRef,
          pledgeClientId("token", operationId),
        );
      } catch (error) {
        console.warn("[fazole] pledge token not queued", error);
        scheduleRetry();
        return false;
      }
    }
    const pledgeInfo = withdrawal.pledge;
    if (
      pledge === null ||
      pledgeInfo === null ||
      !isEnvelopeForPledge(pledge, pledgeInfo.envelopeKey) ||
      to !== pledge.pubkey
    ) {
      return true;
    }
    const remaining =
      pledgeInfo.remainingCzk ??
      pledgeRemainingCzk(pledge, (await ledger.records()).withdrawals);
    await tell(
      to,
      pledgeRepaymentMessage(
        withdrawal.amountSats,
        pledgeInfo.czk,
        remaining,
        pledge.amountCzk,
      ),
      pledgeClientId("text", operationId),
    ).catch((error: unknown) =>
      console.warn("[fazole] pledge repayment not told", error),
    );
    return true;
  };

  nostr.onOutboxResult(PLEDGE_TOKEN_REF, async (result) => {
    const withdrawal = (await ledger.records()).withdrawals.find(
      ({ id }) => tokenRefOf(id) === result.ref,
    );
    if (!withdrawal) return;
    if (result._tag === "OutboxJobSucceeded") {
      await ledger.finishWithdrawal(withdrawal.id, { status: "done" });
      const to = decodeNpub(withdrawal.target);
      if (to) await nostr.sendPaymentNotice(to);
      return;
    }
    console.warn(
      "[fazole] pledge token delivery failed",
      result.detail || result.reason,
    );
    scheduleRetry();
  });

  /**
   * Resolves the inflow's own mint, falling back to the receipt's wallet
   * operation for legacy receipts without a mint column. Never guesses with
   * `richestMint`, so two terminals cannot fund the same key on different mints.
   */
  const resolveMint = async (
    inflow: WalletActivity,
    records: FazoleRecords,
  ): Promise<MintUrl | null> => {
    const known = inflowMint(inflow, records.payments);
    if (known !== null) return parseMintUrl(known);
    if (inflow.kind === "receipt") {
      return wallet.operationMint(inflow.receipt.operationId);
    }
    return null;
  };

  const openEnvelope = (mint: MintUrl, key: EnvelopeKey, amountSats: number) =>
    wallet.run(
      Effect.flatMap(Envelope, (envelope) =>
        envelope.open(
          new EnvelopeOpenDraft({ mint, key, amount: Amount.make(amountSats) }),
        ),
      ),
    );

  const envelopeState = (mint: MintUrl, key: EnvelopeKey) =>
    wallet.run(
      Effect.flatMap(Envelope, (envelope) =>
        envelope.state(new EnvelopeRef({ mint, key })),
      ),
    );

  const sendEnvelope = (mint: MintUrl, key: EnvelopeKey) =>
    wallet.run(
      Effect.flatMap(Envelope, (envelope) =>
        envelope.send(new EnvelopeSendDraft({ mint, key })),
      ),
    );

  /**
   * Opens the step's envelope or adopts one another terminal already funded.
   * Sizes down to `balance - fee` when the swap fee does not fit next to `amountSats`,
   * and still checks the mint when the local balance is zero in case another terminal's
   * proof spend synced ahead of its withdrawal row.
   */
  const resolveEnvelope = async (
    mint: MintUrl,
    key: EnvelopeKey,
    inflowId: string,
    amountSats: number,
  ): Promise<{ readonly envelope: ResolvedEnvelope } | ForwardOutcome> => {
    const balances = await wallet.balances();
    const mintBalance =
      balances.perMint.find((entry) => entry.mint === mint)?.amount ?? 0;
    const feeSats = swapFeeFor(
      await wallet.inputFeePpk(mint),
      await wallet.availableProofCount(mint),
    );
    const openAmount =
      amountSats + feeSats <= mintBalance
        ? amountSats
        : Math.min(amountSats, mintBalance - feeSats);

    if (openAmount <= 0) {
      const state = await envelopeState(mint, key);
      if (Result.isFailure(state)) {
        console.warn("[fazole] pledge envelope state failed", state.failure);
        backoffInflow(inflowId);
        return "stop";
      }
      if (
        state.success.status === "absent" ||
        state.success.operationId === null ||
        state.success.amount <= 0
      ) {
        backoffInflow(inflowId);
        return "continue";
      }
      return {
        envelope: {
          outcome: "adopted",
          operationId: state.success.operationId,
          amount: state.success.amount,
          status: state.success.status,
        },
      };
    }

    let opened = await openEnvelope(mint, key, openAmount);
    if (
      Result.isFailure(opened) &&
      opened.failure._tag === "InsufficientFunds"
    ) {
      const fallback = Math.min(amountSats, opened.failure.available - feeSats);
      if (fallback > 0 && fallback < openAmount) {
        opened = await openEnvelope(mint, key, fallback);
      }
    }
    if (Result.isFailure(opened)) {
      console.warn("[fazole] pledge forward not opened", opened.failure._tag);
      if (opened.failure._tag === "EnvelopeBusy") {
        scheduleRetry(BUSY_RETRY_SEC);
        return "stop";
      }
      backoffInflow(inflowId);
      return opened.failure._tag === "MintUnreachable" ? "stop" : "continue";
    }

    if (opened.success.outcome === "created") {
      return {
        envelope: {
          outcome: "created",
          operationId: opened.success.operationId,
          amount: opened.success.amount,
          status: "unspent",
        },
      };
    }

    const state = await envelopeState(mint, key);
    if (Result.isFailure(state)) {
      console.warn("[fazole] pledge envelope state failed", state.failure);
      scheduleRetry(BUSY_RETRY_SEC);
      return "stop";
    }
    return {
      envelope: {
        outcome: "adopted",
        operationId: opened.success.operationId,
        amount: opened.success.amount,
        status: state.success.status,
      },
    };
  };

  const forwardInflow = async (
    pledge: Pledge,
    inflow: WalletActivity,
    records: FazoleRecords,
    remainingBefore: CzkAmount,
  ): Promise<ForwardOutcome> => {
    const rate = inflowRate(inflow, records.payments) ?? (await czkPerBtc());
    if (rate === null) {
      scheduleRetry();
      return "continue";
    }
    const plan = planForward(remainingBefore, inflow.sats, rate);
    if (plan === null) return "continue";
    const mint = await resolveMint(inflow, records);
    if (mint === null) {
      backoffInflow(inflow.id);
      return "continue";
    }

    const envelopeKey = pledgeEnvelopeKey(pledge, inflow);
    const key = EnvelopeKey.make(envelopeKey);
    const result = await resolveEnvelope(mint, key, inflow.id, plan.amountSats);
    if (typeof result === "string") return result;
    const resolved = result.envelope;

    const czk = repaymentCzkFor(plan, resolved.amount, rate);
    const remainingAfter = CzkAmount.make(Math.max(0, remainingBefore - czk));
    const withdrawalId = transactionIdForOperation(resolved.operationId);

    // Another terminal's row may have synced while the mint answered; keep its
    // accounting and only close it if the mint already saw the envelope spent.
    const existing = (await ledger.records()).withdrawals.find(
      (candidate) => candidate.id === withdrawalId,
    );
    if (existing !== undefined) {
      adoptedAtSec.delete(envelopeKey);
      retryAfterSec.delete(inflow.id);
      if (resolved.status === "spent" && existing.status === "pending") {
        await ledger.finishWithdrawal(existing.id, { status: "done" });
      }
      return "continue";
    }

    // Give the creator the grace window to write and sync its authoritative
    // row (sources, CZK credit, remaining debt) before an adopting terminal
    // writes anything, whether the envelope is still unspent or already spent.
    if (resolved.outcome === "adopted") {
      const now = nowSeconds();
      const firstSeen = adoptedAtSec.get(envelopeKey) ?? now;
      adoptedAtSec.set(envelopeKey, firstSeen);
      const elapsed = now - firstSeen;
      if (elapsed < PENDING_RESUME_GRACE_SEC) {
        scheduleRetry(PENDING_RESUME_GRACE_SEC - elapsed);
        return "stop";
      }
    }

    if (resolved.status === "spent") {
      adoptedAtSec.delete(envelopeKey);
      const withdrawal = await ledger.createWithdrawal({
        kind: "cashu_chat",
        target: encodeNpub(pledge.pubkey),
        amountSats: resolved.amount,
        feeSats: null,
        mintUrl: mint,
        operationId: resolved.operationId,
        status: "done",
        pledge: {
          czk,
          sources: [inflow.id],
          envelopeKey,
          remainingCzk: remainingAfter,
        },
      });
      await ledger.finishWithdrawal(withdrawal.id, { status: "done" });
      retryAfterSec.delete(inflow.id);
      return "done";
    }

    if (resolved.status !== "unspent") {
      console.warn("[fazole] pledge envelope not sendable", resolved.status);
      scheduleRetry();
      return "stop";
    }

    const sent = await sendEnvelope(mint, key);
    if (Result.isFailure(sent)) {
      console.warn("[fazole] pledge envelope not sent", sent.failure._tag);
      scheduleRetry(
        sent.failure._tag === "EnvelopeBusy"
          ? BUSY_RETRY_SEC
          : FORWARD_RETRY_SEC,
      );
      return "stop";
    }

    const withdrawal = await ledger.createWithdrawal({
      kind: "cashu_chat",
      target: encodeNpub(pledge.pubkey),
      amountSats: sent.success.amount,
      feeSats: null,
      mintUrl: mint,
      operationId: sent.success.operationId,
      pledge: {
        czk,
        sources: [inflow.id],
        envelopeKey,
        remainingCzk: remainingAfter,
      },
    });
    adoptedAtSec.delete(envelopeKey);
    retryAfterSec.delete(inflow.id);
    if (withdrawal.status === "done") return "done";

    await deliverRepayment(
      pledge,
      withdrawal,
      sent.success.tokenText,
      sent.success.operationId,
    );
    return "done";
  };

  /**
   * Finishes pending envelope repayments interrupted by a reload, another
   * terminal going offline, or a stale terminal reopening a row after the
   * pledge closed: marks spent envelopes done and re-queues unspent ones past
   * the grace window. Legacy `send` rows have no `envelopeKey` and are left
   * to `withdrawals.resume`.
   */
  const resumePendingRepayments = async (pledge: Pledge | null) => {
    const records = await ledger.records();
    const pendingWithdrawals = records.withdrawals.filter(
      (withdrawal) =>
        withdrawal.kind === "cashu_chat" &&
        withdrawal.status === "pending" &&
        withdrawal.pledge?.envelopeKey !== undefined &&
        withdrawal.operationId !== null,
    );
    if (pendingWithdrawals.length === 0) return;
    const queued = await nostr.queuedRefs();
    const now = nowSeconds();
    for (const withdrawal of pendingWithdrawals) {
      const envelopeKey = withdrawal.pledge?.envelopeKey;
      const operationId = withdrawal.operationId;
      if (envelopeKey === undefined || operationId === null) continue;
      adoptedAtSec.delete(envelopeKey);
      const tokenRef = tokenRefOf(withdrawal.id);
      if (queued.has(tokenRef)) continue;
      const ageSec = now - withdrawal.createdAtSec;
      if (ageSec < PENDING_RESUME_GRACE_SEC) {
        scheduleRetry(PENDING_RESUME_GRACE_SEC - ageSec);
        continue;
      }
      const mint = parseMintUrl(withdrawal.mintUrl);
      if (mint === null) continue;
      const key = EnvelopeKey.make(envelopeKey);
      const state = await envelopeState(mint, key);
      if (Result.isFailure(state)) {
        scheduleRetry();
        continue;
      }
      if (state.success.status === "spent") {
        await ledger.finishWithdrawal(withdrawal.id, { status: "done" });
        continue;
      }
      if (state.success.status !== "unspent") continue;
      const sent = await sendEnvelope(mint, key);
      if (Result.isFailure(sent)) {
        scheduleRetry(
          sent.failure._tag === "EnvelopeBusy"
            ? BUSY_RETRY_SEC
            : FORWARD_RETRY_SEC,
        );
        continue;
      }
      await deliverRepayment(
        pledge,
        withdrawal,
        sent.success.tokenText,
        operationId,
      );
    }
  };

  let pending = false;
  const reconcile = (): Promise<void> => {
    // A run already waiting will see this change too.
    if (pending) return Promise.resolve();
    pending = true;
    return serially(async () => {
      pending = false;
      await whenHydrated();
      const pledge = await current();
      await resumePendingRepayments(pledge);
      if (pledge === null) {
        retryAfterSec.clear();
        adoptedAtSec.clear();
        return;
      }
      const visited = new Set<string>();
      for (;;) {
        // Re-read inflows, step index and remaining debt from the same ledger snapshot
        // so a synced withdrawal never advances the step while leaving its source eligible.
        const records = await ledger.records();
        const remaining = pledgeRemainingCzk(pledge, records.withdrawals);
        if (remaining <= 0) break;
        const now = nowSeconds();
        let next: WalletActivity | null = null;
        for (const candidate of unforwardedInflows(pledge, records, now)) {
          if (visited.has(candidate.id)) continue;
          const holdUntil = retryAfterSec.get(candidate.id);
          if (holdUntil !== undefined && holdUntil > now) {
            scheduleRetry(holdUntil - now);
            continue;
          }
          retryAfterSec.delete(candidate.id);
          next = candidate;
          break;
        }
        if (next === null) break;
        visited.add(next.id);
        const outcome = await forwardInflow(pledge, next, records, remaining);
        if (outcome === "stop") break;
      }
      if (isPledgeSettled(pledge, (await ledger.records()).withdrawals)) {
        retryAfterSec.clear();
        adoptedAtSec.clear();
        await save(null);
      }
    }).catch((error: unknown) =>
      console.warn("[fazole] pledge reconcile failed", error),
    );
  };

  return {
    current,
    open: (contact, amountCzk) =>
      serially(async () => {
        await whenHydrated();
        if ((await current()) !== null) throw new Error("a pledge is open");
        const pledge: Pledge = {
          pubkey: contact.pubkey,
          address: contact.address,
          amountCzk,
          createdAtSec: nowSeconds(),
        };
        await save(pledge);
        await tell(
          pledge.pubkey,
          pledgeOpenedMessage(amountCzk),
          ClientId.make(createId()),
        ).catch((error: unknown) =>
          console.warn("[fazole] pledge opening not told", error),
        );
        return pledge;
      }),
    reconcile,
    live: {
      all: readPledge(settings),
      subscribe: settings.subscribe,
    },
    stop: () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      retryAtMs = null;
    },
  };
};
