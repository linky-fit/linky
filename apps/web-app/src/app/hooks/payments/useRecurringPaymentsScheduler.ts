import type {
  RecurringPaymentId,
  RecurringPaymentsRepository,
} from "@linky-fit/linksync";
import type { EnvelopeState, EnvelopeStatus } from "@linky-fit/linkshu";
import {
  claimPatch,
  isRecurringUnfunded,
  planRecurringPaymentTick,
  readRecurringPaymentOrder,
  RECURRING_CONFIRM_SEC,
  RECURRING_NOTICE_SEC,
  RECURRING_RUN_RETRY_DELAY_SEC,
  recurringAmountSat,
  recurringEnvelopeKey,
  runFailedPatch,
  runNowAction,
  runPaidPatch,
  runSkippedPatch,
  unfundedAction,
  type RecurringPaymentColumns,
  type RecurringPaymentOrder,
  type RecurringPaymentPatch,
  type RecurringRail,
  type RecurringRun,
  type RecurringRunAction,
  type RecurringSkipReason,
  type RecurringTickAction,
  type RecurringUnfundedAction,
} from "@linky-fit/recurring-payment";
import { Effect, Either } from "effect";
import React from "react";
import { reportAppLog } from "../../../devtools/inspector/appLog";
import { useLatest } from "../../../hooks/useLatest";
import type { I18nKey, Translate } from "../../../i18n";
import type {
  DisplayAmountParts,
  FiatRates,
} from "../../../utils/displayAmounts";
import { formatShortNpub } from "../../../utils/formatting";
import { formatMintHost } from "../../../utils/mint";
import { withTabLockIfFree } from "../../../utils/storage";
import { nowSeconds } from "../../../utils/time";
import { getDeviceId } from "../../lib/deviceId";
import {
  paidOverlayContact,
  type PaidOverlayDetails,
} from "../../lib/paidOverlay";
import type { SendMintBalance } from "../../lib/paymentMintSelection";
import { recurringPaymentUpdate } from "../../lib/recurringPaymentStore";
import { recurringRecipient } from "../../lib/recurringRail";
import { runWrite } from "../../lib/storeWrite";
import type {
  ContactRowLike,
  LoggedPaymentEventParams,
} from "../../types/appTypes";
import type { CashuEnvelopes } from "../composition/useLinkshuComposition";
import {
  foundEnvelope,
  payRecurringRun,
  runEnvelopeRef,
  settleDeletedRun,
  type DeletedRunSettlement,
  type RecurringRunResult,
} from "./payRecurringRun";
import type { SendTokenMessage } from "./useSendTokenMessage";

/** Short enough that a payment goes out within seconds of its send time. */
export const RECURRING_TICK_INTERVAL_MS = 15_000;

/** Tabs share the device id, so each would act on the same claim. */
const RECURRING_TAB_LOCK = "linky.recurringPayments";

export type RecurringRunOutcome =
  | "paid"
  | "failed"
  | "waiting"
  | "busy"
  | "missing";

/** A due payment waiting for the in-app countdown to end (or the user to decide). */
export interface RecurringDueConfirmation {
  orderId: RecurringPaymentId;
  /** The planned run; confirming pays exactly this one. */
  runIndex: number;
  dueAtSec: number;
  amountSat: number;
  /** When the countdown ends and the payment goes out on its own. */
  sendAtSec: number;
}

export interface RecurringPaymentsScheduler {
  /** One scheduler pass over every payment. */
  runNow: () => Promise<void>;
  /** Checks every order's current envelope again, as after a wallet restore. */
  recoverEnvelopes: () => Promise<void>;
  /**
   * Pay one payment right away, skipping its notice window and paying its
   * pending period. `busy` means another tab or device is working on it.
   */
  runOrderNow: (orderId: RecurringPaymentId) => Promise<RecurringRunOutcome>;
  dueConfirmation: RecurringDueConfirmation | null;
  /** Pay the confirmed-due payment now instead of waiting the countdown out. */
  confirmDueNow: () => Promise<void>;
  /** Skip the confirmed-due payment's period; the schedule moves to the next due time. */
  cancelDue: () => Promise<void>;
}

interface UseRecurringPaymentsSchedulerParams {
  contacts: readonly ContactRowLike[];
  /** Null until the linkshu runtime is composed; the scheduler waits for it. */
  envelopes: CashuEnvelopes | null;
  fiatRates: FiatRates | null;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  /** Whether the account's data has arrived; the scheduler claims and pays nothing before. */
  hydrated: boolean;
  logPaymentEvent: (event: LoggedPaymentEventParams) => void;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  /** Available sats per mint from the linkshu read model. */
  mintBalances: readonly SendMintBalance[];
  pushToast: (message: string) => void;
  repository: RecurringPaymentsRepository;
  sendTokenMessage: SendTokenMessage;
  showPaidOverlay: (title: string, details: PaidOverlayDetails) => void;
  t: Translate;
  dependencies?: {
    deviceId?: string;
    /** Whether the user is looking at Linky; a visible app asks before paying. */
    isVisible?: () => boolean;
    nowSec?: () => number;
    tickIntervalMs?: number;
  };
}

const SKIPPED_BODY = {
  failed: "recurringSkippedFailingBody",
  insufficientFunds: "recurringSkippedNoFundsBody",
  invalidRecipient: "recurringSkippedRecipientBody",
} as const satisfies Record<Exclude<RecurringSkipReason, "cancelled">, I18nKey>;

/** A partly spent envelope: deleting the order releases the rest, unless it is the contact's token. */
const NEEDS_ATTENTION = {
  cashu: "recurringNeedsAttentionCashu",
  lightning: "recurringNeedsAttention",
} as const satisfies Record<RecurringRail, I18nKey>;

/** What the user and the inspector learn about a deleted Cashu payment's token. */
const DELETED_TOKEN_NOTICE = {
  delivered: {
    body: "recurringDeletedTokenSentBody",
    tag: "recurring.deletedTokenDelivered",
    summary: "token of a deleted recurring payment delivered",
  },
  noRecipient: {
    body: "recurringDeletedTokenKeptBody",
    tag: "recurring.deletedTokenKept",
    summary:
      "token of a deleted recurring payment kept: its contact is unknown here",
  },
  partlySpent: {
    body: "recurringDeletedTokenPartlySpentBody",
    tag: "recurring.deletedTokenKept",
    summary:
      "token of a deleted recurring payment kept: part of it was spent elsewhere",
  },
} as const satisfies Record<
  Exclude<DeletedRunSettlement, "settled" | "later">,
  { body: I18nKey; tag: string; summary: string }
>;

const CANCEL_TOAST = {
  cancelled: "recurringCancelledToast",
  tooLate: "recurringCancelTooLate",
  busy: "recurringWalletBusy",
} as const satisfies Record<string, I18nKey>;

const OUTCOME: Record<RecurringRunResult["kind"], RecurringRunOutcome> = {
  paid: "paid",
  waiting: "waiting",
  busy: "busy",
  unfunded: "waiting",
  noRecipient: "failed",
  mixed: "failed",
  failed: "failed",
};

const orderLinks = (order: RecurringPaymentOrder): Record<string, string> => ({
  recurringPayment: order.id,
  contact: order.contactId,
});

const documentIsVisible = (): boolean =>
  typeof document === "undefined" || document.visibilityState === "visible";

export const contactDisplayName = (contact: ContactRowLike): string => {
  const npub = String(contact.npub ?? "").trim();
  return (
    String(contact.name ?? "").trim() ||
    String(contact.lnAddress ?? "").trim() ||
    (npub ? formatShortNpub(npub) : "")
  );
};

/** Runs `pass` unless another tab is in a pass; `busy` when one is. */
const inTabLock = async <A>(pass: () => Promise<A>): Promise<A | "busy"> =>
  (await withTabLockIfFree({
    key: RECURRING_TAB_LOCK,
    ttlMs: 30_000,
    fn: pass,
  })) ?? "busy";

const readOrders = (
  records: ReadonlyArray<RecurringPaymentColumns>,
): RecurringPaymentOrder[] =>
  records.flatMap((record) => {
    const order = readRecurringPaymentOrder(record);
    return order === null ? [] : [order];
  });

const runKey = (run: Pick<RecurringRun, "order" | "runIndex">): string =>
  recurringEnvelopeKey(run.order.id, run.runIndex);

/** Recovery walks an order's envelopes once while live, and once more after deletion. */
const recoveryKey = (order: RecurringPaymentOrder, deleted: boolean): string =>
  `${deleted ? "deleted" : "live"}:${recurringEnvelopeKey(order.id, order.schedule.runCount)}`;

/** Per key: when to ask the mint again, or `settled` once nothing is left to ask. */
type MintChecks = ReadonlyMap<string, number | "settled">;

const isCheckDue = (
  checks: MintChecks,
  key: string,
  nowSec: number,
): boolean => {
  const next = checks.get(key) ?? 0;
  return typeof next === "number" && nowSec >= next;
};

const isPaymentOut = (status: EnvelopeStatus): boolean =>
  status === "spent" || status === "pending";

/** Picks the run an on-demand payment pays, from the order as it is stored now. */
type PickRun = (order: RecurringPaymentOrder) => RecurringRun;

const nextRun: PickRun = (order) => ({
  order,
  runIndex: order.schedule.runCount,
  dueAtSec: order.schedule.nextDueAtSec,
});

/** The countdown's own run, never the latest count: if another tab paid it, its spent envelope settles it. */
const plannedRun =
  (pending: RecurringDueConfirmation): PickRun =>
  (order) => ({
    order,
    runIndex: pending.runIndex,
    dueAtSec: pending.dueAtSec,
  });

const onDemand = (
  run: RecurringRun,
  amountSat: number,
): RecurringRunAction => ({
  ...runNowAction(run.order, amountSat),
  ...run,
});

/**
 * Runs recurring payments on whichever device is online. Before a payment is
 * due (or as soon as an overdue one is noticed) a device claims it on the row
 * and notifies the user. When the notice window ends the device named by the
 * claim pays it: silently when Linky is in the background, after a short
 * in-app countdown with pay-now and cancel when it is visible. The claim only
 * decides who notifies; the run's envelope at the order's mint keeps any
 * number of devices and tabs from paying it twice. A run whose envelope the
 * mint already signed needs no balance, rate or countdown. Each pass first
 * walks the envelopes of every order not checked yet this session, live
 * ones and deleted ones, and settles those of deleted orders.
 */
export const useRecurringPaymentsScheduler = ({
  contacts,
  dependencies,
  envelopes,
  fiatRates,
  formatDisplayedAmountParts,
  hydrated,
  logPaymentEvent,
  maybeShowPwaNotification,
  mintBalances,
  pushToast,
  repository,
  sendTokenMessage,
  showPaidOverlay,
  t,
}: UseRecurringPaymentsSchedulerParams): RecurringPaymentsScheduler => {
  const latest = useLatest({
    contacts,
    envelopes,
    fiatRates,
    formatDisplayedAmountParts,
    logPaymentEvent,
    maybeShowPwaNotification,
    mintBalances,
    pushToast,
    repository,
    sendTokenMessage,
    showPaidOverlay,
    t,
  });
  const enabled = envelopes !== null && hydrated;
  const nowSec = dependencies?.nowSec ?? nowSeconds;
  const isVisible = dependencies?.isVisible ?? documentIsVisible;
  const deviceId = dependencies?.deviceId ?? getDeviceId();
  const tickIntervalMs =
    dependencies?.tickIntervalMs ?? RECURRING_TICK_INTERVAL_MS;
  const tickInFlightRef = React.useRef<Promise<void> | null>(null);
  const retryNotBeforeRef = React.useRef(new Map<RecurringPaymentId, number>());
  /** Notices shown once per session. */
  const reportedRef = React.useRef(new Set<string>());
  /** Per `recoveryKey`: when to walk the order's envelopes again. */
  const recoveryChecksRef = React.useRef(new Map<string, number | "settled">());
  /** Per run key: when to ask whether the mint signed its envelope. */
  const envelopeChecksRef = React.useRef(new Map<string, number>());
  /** Per run key: the sats of a run whose envelope the mint signed. */
  const fundedEnvelopeSatRef = React.useRef(new Map<string, number>());
  const [dueConfirmation, setDueConfirmation] =
    React.useState<RecurringDueConfirmation | null>(null);
  const dueConfirmationRef = useLatest(dueConfirmation);

  const loadOrders = React.useCallback(
    async () =>
      readOrders(await Effect.runPromise(latest.current.repository.all)),
    [latest],
  );

  const patchOrder = React.useCallback(
    async (
      order: RecurringPaymentOrder,
      patch: RecurringPaymentPatch,
    ): Promise<void> => {
      const outcome = await runWrite(
        latest.current.repository.update(
          order.id,
          recurringPaymentUpdate(patch),
        ),
      );
      if (!outcome.ok) {
        console.warn("[linky][recurring] row update failed", outcome.error);
      }
    },
    [latest],
  );

  const findContact = React.useCallback(
    (contactId: string): ContactRowLike | undefined =>
      latest.current.contacts.find(
        (candidate) => (candidate.id ?? "") === contactId,
      ),
    [latest],
  );

  const formatAmount = React.useCallback(
    (amountSat: number) => {
      const parts = latest.current.formatDisplayedAmountParts(amountSat);
      return {
        amount: `${parts.approxPrefix}${parts.amountText}`,
        unit: parts.unitLabel,
      };
    },
    [latest],
  );

  const orderAmountSat = React.useCallback(
    (order: RecurringPaymentOrder): number =>
      recurringAmountSat(order.amount, latest.current.fiatRates) ?? 0,
    [latest],
  );

  const notifyOrder = React.useCallback(
    (
      order: RecurringPaymentOrder,
      amountSat: number,
      body: string,
      tag: string,
    ): void => {
      const contact = findContact(order.contactId);
      const { amount, unit } = formatAmount(amountSat);
      void latest.current
        .maybeShowPwaNotification(
          latest.current.t("recurringPaymentTitle"),
          body
            .replace("{amount}", amount)
            .replace("{unit}", unit)
            .replace("{name}", contact ? contactDisplayName(contact) : "")
            .replaceAll("{mint}", formatMintHost(order.mintUrl)),
          tag,
        )
        .catch(() => undefined);
    },
    [findContact, formatAmount, latest],
  );

  const claimOrder = React.useCallback(
    async (
      action: Extract<RecurringTickAction, { kind: "claim" }>,
    ): Promise<void> => {
      const { order, dueAtSec, takeover } = action;
      const now = nowSec();
      await patchOrder(order, claimPatch(deviceId, now, dueAtSec));
      const minutes = Math.max(
        1,
        Math.ceil((Math.max(dueAtSec, now + RECURRING_NOTICE_SEC) - now) / 60),
      );
      notifyOrder(
        order,
        orderAmountSat(order),
        latest.current
          .t("recurringNotifyBody")
          .replace("{minutes}", String(minutes)),
        `recurring:${order.id}:${dueAtSec}`,
      );
      reportAppLog({
        tag: "recurring.claimed",
        summary: `recurring payment claimed${takeover ? " (takeover)" : ""}`,
        links: orderLinks(order),
        payload: {
          deviceId,
          dueAtSec,
          previousClaim: order.claim,
          takeover,
        },
      });
    },
    [deviceId, latest, notifyOrder, nowSec, orderAmountSat, patchOrder],
  );

  const notifySkipped = React.useCallback(
    (
      order: RecurringPaymentOrder,
      amountSat: number,
      dueAtSec: number,
      reason: keyof typeof SKIPPED_BODY,
    ): void => {
      notifyOrder(
        order,
        amountSat,
        latest.current.t(SKIPPED_BODY[reason]),
        `recurring-skipped:${order.id}:${dueAtSec}`,
      );
    },
    [latest, notifyOrder],
  );

  const announcePaid = React.useCallback(
    (action: RecurringRunAction, amountSat: number): void => {
      const { order } = action;
      const contact = findContact(order.contactId);
      const { amount, unit } = formatAmount(amountSat);
      latest.current.showPaidOverlay(
        latest.current
          .t("paidSentTo")
          .replace("{amount}", amount)
          .replace("{unit}", unit)
          .replace("{name}", contact ? contactDisplayName(contact) : ""),
        {
          direction: "out",
          amountSat,
          contact: paidOverlayContact(contact),
        },
      );
      notifyOrder(
        order,
        amountSat,
        latest.current.t("recurringSentBody"),
        `recurring-sent:${order.id}:${action.dueAtSec}`,
      );
    },
    [findContact, formatAmount, latest, notifyOrder],
  );

  const announceFailed = React.useCallback(
    (action: RecurringRunAction, needsAttention: boolean): void => {
      const { order } = action;
      latest.current.pushToast(
        latest.current
          .t(
            needsAttention
              ? NEEDS_ATTENTION[order.rail]
              : "recurringRunFailedToast",
          )
          .replace("{mint}", formatMintHost(order.mintUrl)),
      );
      notifyOrder(
        order,
        action.amountSat,
        latest.current.t("recurringFailedBody"),
        `recurring-failed:${order.id}:${action.dueAtSec}`,
      );
    },
    [latest, notifyOrder],
  );

  const reportWait = React.useCallback(
    (
      action: Extract<RecurringTickAction, { kind: "waitFunds" | "waitRates" }>,
    ): void => {
      const { order, dueAtSec } = action;
      const key = `${action.kind}:${order.id}:${dueAtSec}`;
      if (reportedRef.current.has(key)) return;
      reportedRef.current.add(key);
      const waitsForFunds = action.kind === "waitFunds";
      latest.current.pushToast(
        latest.current
          .t(
            waitsForFunds
              ? "recurringWaitingForFunds"
              : "recurringWaitingForRates",
          )
          .replace("{mint}", formatMintHost(order.mintUrl)),
      );
      if (waitsForFunds) {
        notifyOrder(
          order,
          orderAmountSat(order),
          latest.current.t("recurringWaitingForFundsBody"),
          `recurring-waiting:${order.id}:${dueAtSec}`,
        );
      }
      reportAppLog({
        tag: waitsForFunds
          ? "recurring.waitingForFunds"
          : "recurring.waitingForRates",
        summary: waitsForFunds
          ? "recurring payment waits for funds at its mint"
          : "recurring payment waits for an exchange rate",
        links: orderLinks(order),
        payload: {
          amount: order.amount,
          balanceSat:
            latest.current.mintBalances.find(
              ({ mint }) => mint === order.mintUrl,
            )?.amount ?? 0,
          dueAtSec,
          mint: order.mintUrl,
        },
      });
    },
    [latest, notifyOrder, orderAmountSat],
  );

  const skipPeriod = React.useCallback(
    async (action: Extract<RecurringTickAction, { kind: "skip" }>) => {
      const { order, dueAtSec, reason } = action;
      await patchOrder(order, runSkippedPatch(action, nowSec()));
      notifySkipped(order, orderAmountSat(order), dueAtSec, reason);
      reportAppLog({
        tag: "recurring.skipped",
        summary: `recurring payment skipped (${reason})`,
        links: orderLinks(order),
        payload: { dueAtSec, reason },
      });
    },
    [notifySkipped, nowSec, orderAmountSat, patchOrder],
  );

  const settleUnfunded = React.useCallback(
    async (action: RecurringUnfundedAction): Promise<void> => {
      if (action.kind === "skip") await skipPeriod(action);
      else reportWait(action);
    },
    [reportWait, skipPeriod],
  );

  const skipUnpayable = React.useCallback(
    async (action: RecurringRunAction): Promise<void> => {
      const { order, amountSat, dueAtSec } = action;
      await patchOrder(order, runSkippedPatch(action, nowSec()));
      latest.current.pushToast(
        latest.current.t("recurringRecipientUnavailable"),
      );
      notifySkipped(order, amountSat, dueAtSec, "invalidRecipient");
      reportAppLog({
        tag: "recurring.skipped",
        summary: "recurring payment skipped (recipient cannot be paid)",
        links: orderLinks(order),
        payload: { dueAtSec, reason: "invalidRecipient" },
      });
    },
    [latest, notifySkipped, nowSec, patchOrder],
  );

  const settleRun = React.useCallback(
    async (
      action: RecurringRunAction,
      result: RecurringRunResult,
    ): Promise<void> => {
      const { order } = action;
      const now = nowSec();
      const retryLater = () =>
        retryNotBeforeRef.current.set(
          order.id,
          now + RECURRING_RUN_RETRY_DELAY_SEC,
        );
      switch (result.kind) {
        case "paid":
          await patchOrder(order, runPaidPatch(action, now));
          if (result.delivered) announcePaid(action, result.amountSat);
          break;
        case "failed":
        case "mixed":
          await patchOrder(order, runFailedPatch(now));
          retryLater();
          announceFailed(action, result.kind === "mixed");
          break;
        case "unfunded":
          retryLater();
          await settleUnfunded(unfundedAction(action, now));
          break;
        case "noRecipient":
          await skipUnpayable(action);
          break;
        case "busy":
          retryLater();
          break;
        case "waiting":
          break;
      }
      reportAppLog({
        tag: "recurring.run",
        summary: `recurring payment run: ${result.kind}`,
        links: {
          ...orderLinks(order),
          ...("operationId" in result && result.operationId !== null
            ? { operation: result.operationId }
            : {}),
        },
        payload: {
          amount: order.amount,
          amountSat: action.amountSat,
          dueAtSec: action.dueAtSec,
          missedCount: action.missedCount,
          mint: order.mintUrl,
          runIndex: action.runIndex,
          status: result.kind,
          ...(result.kind === "paid"
            ? { delivered: result.delivered, paidSat: result.amountSat }
            : {}),
          ...(result.kind === "failed" ? { error: result.error } : {}),
        },
      });
    },
    [
      announceFailed,
      announcePaid,
      nowSec,
      patchOrder,
      settleUnfunded,
      skipUnpayable,
    ],
  );

  const isFunded = React.useCallback(
    (run: RecurringRun): boolean =>
      fundedEnvelopeSatRef.current.has(runKey(run)),
    [],
  );

  const markFunded = React.useCallback(
    (run: RecurringRun, amountSat: number): void => {
      fundedEnvelopeSatRef.current.set(runKey(run), amountSat);
    },
    [],
  );

  /** The one path every payment takes: scheduler, countdown and "Pay now". */
  const executeRun = React.useCallback(
    async (action: RecurringRunAction): Promise<RecurringRunOutcome> => {
      const { envelopes, logPaymentEvent, sendTokenMessage } = latest.current;
      if (envelopes === null) return "busy";
      const { order } = action;
      const result = await payRecurringRun(
        { envelopes, logPaymentEvent, sendTokenMessage },
        action,
        recurringRecipient(findContact(order.contactId), order.rail),
      );
      if (foundEnvelope(result) && !isFunded(action)) {
        markFunded(action, action.amountSat);
      }
      await settleRun(action, result);
      return OUTCOME[result.kind];
    },
    [findContact, isFunded, latest, markFunded, settleRun],
  );

  /**
   * Pays the run `pickRun` picks, outside the planner. A run whose envelope
   * is known funded pays its amount; any other needs the order's amount in sats.
   */
  const runOrder = React.useCallback(
    async (
      orderId: RecurringPaymentId,
      pickRun: PickRun,
    ): Promise<RecurringRunOutcome> => {
      if (tickInFlightRef.current) await tickInFlightRef.current;
      setDueConfirmation((current) =>
        current?.orderId === orderId ? null : current,
      );
      const pass = inTabLock(async (): Promise<RecurringRunOutcome> => {
        const order = (await loadOrders()).find(
          (candidate) => candidate.id === orderId,
        );
        if (!order) return "missing";
        const run = pickRun(order);
        const amountSat =
          fundedEnvelopeSatRef.current.get(runKey(run)) ??
          recurringAmountSat(order.amount, latest.current.fiatRates);
        if (amountSat === null) {
          latest.current.pushToast(
            latest.current.t("recurringWaitingForRates"),
          );
          return "failed";
        }
        await patchOrder(order, claimPatch(deviceId, nowSec(), run.dueAtSec));
        return executeRun(onDemand(run, amountSat));
      }).finally(() => {
        tickInFlightRef.current = null;
      });
      tickInFlightRef.current = pass.then(() => undefined);
      return pass;
    },
    [deviceId, executeRun, latest, loadOrders, nowSec, patchOrder],
  );

  const runOrderNow = React.useCallback(
    (orderId: RecurringPaymentId) => runOrder(orderId, nextRun),
    [runOrder],
  );

  const notifyOnce = React.useCallback(
    (
      order: RecurringPaymentOrder,
      amountSat: number,
      body: I18nKey,
      tag: string,
    ): void => {
      if (reportedRef.current.has(tag)) return;
      reportedRef.current.add(tag);
      notifyOrder(order, amountSat, latest.current.t(body), tag);
    },
    [latest, notifyOrder],
  );

  /** Settles one envelope of a deleted order and tells the user what became of a Cashu token. */
  const settleDeleted = React.useCallback(
    async (run: RecurringRun, state: EnvelopeState): Promise<boolean> => {
      const { envelopes, logPaymentEvent, sendTokenMessage } = latest.current;
      if (envelopes === null) return false;
      const { order } = run;
      const settlement = await settleDeletedRun(
        { envelopes, logPaymentEvent, sendTokenMessage },
        run,
        state,
        recurringRecipient(findContact(order.contactId), order.rail),
      );
      if (settlement === "settled") return true;
      if (settlement === "later") return false;
      const key = runKey(run);
      const notice = DELETED_TOKEN_NOTICE[settlement];
      notifyOnce(
        order,
        state.amount,
        notice.body,
        `recurring-deleted-${settlement}:${key}`,
      );
      reportAppLog({
        tag: notice.tag,
        summary: notice.summary,
        links: orderLinks(order),
        payload: { key, amountSat: state.amount },
      });
      return settlement === "delivered";
    },
    [findContact, latest, notifyOnce],
  );

  /**
   * Walks the order's envelopes from its current run up to the first the
   * mint never signed: a stale write can move `runCount` back below an
   * envelope already funded. Each one found is adopted and counts as
   * funded; a spent current run of a live order is paid right away, and a
   * deleted order's are settled. `settled` once nothing is left to do.
   */
  const recoverOrder = React.useCallback(
    async (
      order: RecurringPaymentOrder,
      deleted: boolean,
    ): Promise<{ settled: boolean; paid: boolean }> => {
      const envelopes = latest.current.envelopes;
      if (envelopes === null) return { settled: false, paid: false };
      const checked: Array<{ key: string; status: EnvelopeStatus }> = [];
      let settled = true;
      let paid = false;
      for (let runIndex = order.schedule.runCount; ; runIndex += 1) {
        const run = { order, runIndex, dueAtSec: order.schedule.nextDueAtSec };
        const state = await envelopes.state(runEnvelopeRef(run));
        if (Either.isLeft(state)) {
          settled = false;
          break;
        }
        const { status, amount } = state.right;
        checked.push({ key: runKey(run), status });
        if (status === "absent") break;
        markFunded(run, amount);
        if (deleted) {
          if (!(await settleDeleted(run, state.right))) settled = false;
        } else if (status === "spent" && runIndex === order.schedule.runCount) {
          await executeRun(onDemand(run, amount));
          paid = true;
        }
      }
      reportAppLog({
        tag: "recurring.envelopesRecovered",
        summary: `checked ${checked.length} envelopes of a ${deleted ? "deleted " : ""}recurring payment`,
        links: orderLinks(order),
        payload: { deleted, envelopes: checked, mint: order.mintUrl, settled },
      });
      return { settled, paid };
    },
    [executeRun, latest, markFunded, settleDeleted],
  );

  /**
   * Walks the envelopes of every live and deleted order not done yet;
   * unfinished ones again after the retry delay. Returns the live orders
   * whose current run it found spent and paid.
   */
  const recoverOrderEnvelopes = React.useCallback(
    async (
      live: ReadonlyArray<RecurringPaymentOrder>,
    ): Promise<ReadonlySet<RecurringPaymentId>> => {
      const deleted = readOrders(
        await Effect.runPromise(latest.current.repository.deleted),
      );
      const orders = [
        ...live.map((order) => ({ order, deleted: false })),
        ...deleted.map((order) => ({ order, deleted: true })),
      ];
      const paidOrders = new Set<RecurringPaymentId>();
      for (const { order, deleted } of orders) {
        const key = recoveryKey(order, deleted);
        const now = nowSec();
        if (!isCheckDue(recoveryChecksRef.current, key, now)) continue;
        const { settled, paid } = await recoverOrder(order, deleted);
        recoveryChecksRef.current.set(
          key,
          settled ? "settled" : now + RECURRING_RUN_RETRY_DELAY_SEC,
        );
        if (paid) paidOrders.add(order.id);
      }
      return paidOrders;
    },
    [latest, nowSec, recoverOrder],
  );

  /**
   * The run of an unfunded action when the mint already signed its envelope
   * (funded before a restart or by another device); such a run needs no
   * balance. The mint is asked once per retry delay until it turns up.
   */
  const fundedRun = React.useCallback(
    async (action: RecurringTickAction): Promise<RecurringRunAction | null> => {
      const envelopes = latest.current.envelopes;
      if (!isRecurringUnfunded(action) || envelopes === null) return null;
      const key = runKey(action.run);
      const now = nowSec();
      if (!isCheckDue(envelopeChecksRef.current, key, now)) return null;
      envelopeChecksRef.current.set(key, now + RECURRING_RUN_RETRY_DELAY_SEC);
      const state = await envelopes.state(runEnvelopeRef(action.run));
      if (Either.isLeft(state) || state.right.status === "absent") return null;
      markFunded(action.run, state.right.amount);
      return { ...action.run, amountSat: state.right.amount };
    },
    [latest, markFunded, nowSec],
  );

  const tick = React.useCallback(async (): Promise<void> => {
    if (tickInFlightRef.current) return tickInFlightRef.current;
    if (latest.current.envelopes === null) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    const pass = inTabLock(async () => {
      const orders = await loadOrders();
      const paidInRecovery = await recoverOrderEnvelopes(orders);
      const now = nowSec();
      const actions = planRecurringPaymentTick({
        // The rows read before recovery paid these are stale until the next pass.
        orders: orders.filter((order) => !paidInRecovery.has(order.id)),
        nowSec: now,
        deviceId,
        balanceSatByMint: new Map(
          latest.current.mintBalances.map(({ mint, amount }) => [mint, amount]),
        ),
        fiatRates: latest.current.fiatRates,
        fundedEnvelopeSat: fundedEnvelopeSatRef.current,
        retryNotBeforeSec: retryNotBeforeRef.current,
      });
      let awaitingConfirmation: RecurringDueConfirmation | null = null;

      for (const planned of actions) {
        const action = (await fundedRun(planned)) ?? planned;
        switch (action.kind) {
          case "claim":
            await claimOrder(action);
            break;
          case "skip":
            await skipPeriod(action);
            break;
          case "waitFunds":
          case "waitRates":
            reportWait(action);
            break;
          case "run": {
            if (isVisible() && !isFunded(action)) {
              // The user is looking at Linky: show the countdown instead of
              // paying silently. One payment at a time; the rest follow.
              const current = dueConfirmationRef.current;
              awaitingConfirmation =
                current?.orderId === action.order.id &&
                current.runIndex === action.runIndex &&
                current.dueAtSec === action.dueAtSec
                  ? current
                  : {
                      orderId: action.order.id,
                      runIndex: action.runIndex,
                      dueAtSec: action.dueAtSec,
                      amountSat: action.amountSat,
                      sendAtSec: now + RECURRING_CONFIRM_SEC,
                    };
              if (awaitingConfirmation !== current) {
                reportAppLog({
                  tag: "recurring.confirmationShown",
                  summary: "recurring payment countdown shown",
                  links: orderLinks(action.order),
                  payload: {
                    amountSat: action.amountSat,
                    dueAtSec: action.dueAtSec,
                    runIndex: action.runIndex,
                    sendAtSec: awaitingConfirmation.sendAtSec,
                  },
                });
              }
              setDueConfirmation(awaitingConfirmation);
              return;
            }
            await executeRun(action);
            break;
          }
        }
      }
      if (awaitingConfirmation === null) setDueConfirmation(null);
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn("[linky][recurring] scheduler tick failed", error);
      })
      .finally(() => {
        tickInFlightRef.current = null;
      });
    tickInFlightRef.current = pass;
    return pass;
  }, [
    claimOrder,
    deviceId,
    dueConfirmationRef,
    executeRun,
    fundedRun,
    isFunded,
    isVisible,
    latest,
    loadOrders,
    nowSec,
    recoverOrderEnvelopes,
    reportWait,
    skipPeriod,
  ]);

  const recoverEnvelopes = React.useCallback(async (): Promise<void> => {
    while (tickInFlightRef.current) await tickInFlightRef.current;
    recoveryChecksRef.current.clear();
    await tick();
  }, [tick]);

  const confirmDueNow = React.useCallback(async (): Promise<void> => {
    const pending = dueConfirmationRef.current;
    if (pending === null) return;
    setDueConfirmation(null);
    const outcome = await runOrder(pending.orderId, plannedRun(pending));
    if (outcome === "busy") {
      latest.current.pushToast(latest.current.t("recurringWalletBusy"));
    }
  }, [dueConfirmationRef, latest, runOrder]);

  /** Whether the countdown's run already went out (or is going out) from its envelope. */
  const isRunOut = React.useCallback(
    async (run: Pick<RecurringRun, "order" | "runIndex">): Promise<boolean> => {
      const envelopes = latest.current.envelopes;
      if (envelopes === null) return false;
      const state = await envelopes.state(runEnvelopeRef(run));
      return Either.isRight(state) && isPaymentOut(state.right.status);
    },
    [latest],
  );

  /** Skips the countdown's period unless its run is already paid or going out. */
  const cancelRun = React.useCallback(
    async (
      pending: RecurringDueConfirmation,
    ): Promise<"cancelled" | "tooLate" | "missing"> => {
      const order = (await loadOrders()).find(
        (candidate) => candidate.id === pending.orderId,
      );
      if (!order) return "missing";
      if (order.schedule.runCount !== pending.runIndex) return "tooLate";
      if (await isRunOut({ order, runIndex: pending.runIndex })) {
        await executeRun(
          onDemand(plannedRun(pending)(order), pending.amountSat),
        );
        return "tooLate";
      }
      const patch = runSkippedPatch(
        { order, dueAtSec: pending.dueAtSec },
        nowSec(),
      );
      await patchOrder(order, patch);
      reportAppLog({
        tag: "recurring.skipped",
        summary: "recurring payment skipped (cancelled by the user)",
        links: orderLinks(order),
        payload: {
          dueAtSec: pending.dueAtSec,
          progress: patch.progress ?? null,
          reason: "cancelled",
        },
      });
      return "cancelled";
    },
    [executeRun, isRunOut, loadOrders, nowSec, patchOrder],
  );

  const cancelDue = React.useCallback(async (): Promise<void> => {
    const pending = dueConfirmationRef.current;
    if (pending === null) return;
    setDueConfirmation(null);
    if (tickInFlightRef.current) await tickInFlightRef.current;
    const outcome = await inTabLock(() => cancelRun(pending));
    if (outcome === "missing") return;
    latest.current.pushToast(latest.current.t(CANCEL_TOAST[outcome]));
  }, [cancelRun, dueConfirmationRef, latest]);

  React.useEffect(() => {
    if (!enabled) return;
    void tick();
    const interval = window.setInterval(() => void tick(), tickIntervalMs);
    const onOnline = () => void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, tick, tickIntervalMs]);

  return {
    runNow: tick,
    recoverEnvelopes,
    runOrderNow,
    dueConfirmation,
    confirmDueNow,
    cancelDue,
  };
};
