import { ClientId, encodeNpub, MessageText } from "@linky-fit/linkstr";
import { createId } from "@linky-fit/linksync";
import type { LiveSource } from "@linky-fit/linksync/react";
import { Effect, Result } from "effect";
import {
  FORWARD_RETRY_SEC,
  isPledgeSettled,
  planForward,
  pledgeOpenedMessage,
  pledgeRemainingCzk,
  pledgeRepaymentMessage,
  repaymentCzkFor,
  unforwardedInflows,
  type CzkAmount,
  type Pledge,
  type WithdrawTarget,
} from "../domain";
import type { Ledger } from "../storage/ledger";
import { readPledge, savePledge } from "../storage/pledgeSetting";
import type { SettingsRepository } from "../storage/shop";
import { nowSeconds } from "../utils/time";
import type { ResolvedContact } from "./contacts";
import type { Nostr } from "./nostr";
import { exclusive } from "./serial";
import type { Withdrawals } from "./withdrawals";

const PLEDGE_REF = "fazole.pledge:";

/**
 * Cash taken from a Linky user against the bitcoin the shop will receive:
 * while a pledge is open, every inflow is forwarded to them as a Linky
 * withdrawal until the CZK amount is repaid, and they get a chat message
 * at each step. The merchant owes one person at a time.
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
   * Forwards what reached the wallet since the pledge and closes a repaid
   * one; idempotent, so it runs on every change. Needs the rate: without
   * one the inflows wait for the next run.
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
  withdrawals,
  czkPerBtc,
  whenHydrated,
}: {
  readonly ledger: Ledger;
  readonly settings: SettingsRepository;
  readonly nostr: Nostr;
  readonly withdrawals: Withdrawals;
  readonly czkPerBtc: () => Promise<number | null>;
  /** Resolves once background writes may run. */
  readonly whenHydrated: () => Promise<void>;
}): Pledges => {
  const serially = exclusive();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleRetry = () => {
    if (retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void reconcile();
    }, FORWARD_RETRY_SEC * 1000);
  };
  const current = () => Effect.runPromise(readPledge(settings));
  const save = (pledge: Pledge | null) =>
    Effect.runPromise(savePledge(settings, pledge));

  const tell = async (pledge: Pledge, text: string) => {
    const clientId = ClientId.make(createId());
    await nostr.sendText(
      pledge.pubkey,
      MessageText.make(text),
      clientId,
      `${PLEDGE_REF}${clientId}`,
    );
  };

  const targetOf = (pledge: Pledge): WithdrawTarget => ({
    kind: "cashu_chat",
    pubkey: pledge.pubkey,
    npub: encodeNpub(pledge.pubkey),
  });

  /** Prices the forward; when the fee does not fit next to it, as much as the balance allows. */
  const quoteForward = async (pledge: Pledge, amountSats: number) => {
    const target = targetOf(pledge);
    const exact = await withdrawals.quote(target, { amountSats });
    if (Result.isSuccess(exact) || exact.failure !== "insufficient-funds") {
      return exact;
    }
    const whole = await withdrawals.quote(target);
    return Result.isSuccess(whole) && whole.success.amountSats < amountSats
      ? whole
      : exact;
  };

  const forward = async (pledge: Pledge, remainingCzk: CzkAmount) => {
    const records = await ledger.records();
    const inflows = unforwardedInflows(pledge, records, nowSeconds());
    if (inflows.length === 0) return;
    const rate = await czkPerBtc();
    if (rate === null) {
      scheduleRetry();
      return;
    }
    const plan = planForward(
      remainingCzk,
      inflows.reduce((total, inflow) => total + inflow.sats, 0),
      rate,
    );
    if (plan === null) return;
    const quoted = await quoteForward(pledge, plan.amountSats);
    if (Result.isFailure(quoted)) {
      console.warn("[fazole] pledge forward not quoted", quoted.failure);
      scheduleRetry();
      return;
    }
    const czk = repaymentCzkFor(plan, quoted.success.amountSats, rate);
    const executed = await withdrawals.execute(quoted.success, {
      pledge: { czk, sources: inflows.map((inflow) => inflow.id) },
    });
    if (Result.isFailure(executed)) {
      console.warn("[fazole] pledge forward failed", executed.failure);
      scheduleRetry();
      return;
    }
    const { amountSats } = executed.success.withdrawal;
    await tell(
      pledge,
      pledgeRepaymentMessage(
        amountSats,
        czk,
        pledgeRemainingCzk(pledge, (await ledger.records()).withdrawals),
        pledge.amountCzk,
      ),
    ).catch((error: unknown) =>
      console.warn("[fazole] pledge repayment not told", error),
    );
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
      if (pledge === null) return;
      const remaining = pledgeRemainingCzk(
        pledge,
        (await ledger.records()).withdrawals,
      );
      if (remaining > 0) await forward(pledge, remaining);
      if (isPledgeSettled(pledge, (await ledger.records()).withdrawals)) {
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
        await tell(pledge, pledgeOpenedMessage(amountCzk)).catch(
          (error: unknown) =>
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
    },
  };
};
