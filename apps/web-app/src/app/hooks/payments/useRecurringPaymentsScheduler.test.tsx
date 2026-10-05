import {
  Amount,
  EnvelopeBusy,
  EnvelopeKey,
  EnvelopeNotFound,
  EnvelopeOpened,
  EnvelopeReleased,
  EnvelopeState,
  EnvelopeToken,
  InsufficientFunds,
  MeltReceipt,
  MintUnreachable,
  MintUrl,
  NonNegativeAmount,
  OperationId,
  PaymentPending,
  QuoteId,
  TokenText,
  type EnvelopeStatus,
} from "@linky-fit/linkshu";
import {
  makeRecurringPaymentsRepository,
  NonEmptyString100,
  NonEmptyString1000,
  normalizeRecurringPayment,
  PositiveInt,
  type RecurringPaymentsRepository,
} from "@linky-fit/linksync";
import {
  RECURRING_CONFIRM_SEC,
  RECURRING_RUN_RETRY_DELAY_SEC,
  readRecurringPaymentOrder,
  recurringEnvelopeKey,
  recurringProgressColumn,
  type RecurringRail,
} from "@linky-fit/recurring-payment";
import { Effect, Either } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import {
  contactIdFor,
  DUE,
  HOUR,
  recurringPaymentIdFor,
} from "../../../testUtils/recurringOrders";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { recurringPaymentUpdate } from "../../lib/recurringPaymentStore";
import type { ContactRowLike } from "../../types/appTypes";
import type { CashuEnvelopes } from "../composition/useLinkshuComposition";
import { useRecurringPaymentsScheduler } from "./useRecurringPaymentsScheduler";

const reportAppLogMock = vi.hoisted(() => vi.fn());
vi.mock("../../../devtools/inspector/appLog", () => ({
  reportAppLog: reportAppLogMock,
}));

const fetchLnurlInvoiceMock = vi.hoisted(() =>
  vi.fn(async (_target: string, amountSat: number) => ({
    lightningAddress: "bob@example.com",
    pr: `lnbc-mock-${amountSat}`,
    successAction: null,
  })),
);
vi.mock("../../../lnurlPay", () => ({
  fetchLnurlInvoiceForTarget: fetchLnurlInvoiceMock,
}));

type Params = Parameters<typeof useRecurringPaymentsScheduler>[0];
type Scheduler = ReturnType<typeof useRecurringPaymentsScheduler>;

const NOW = DUE + 90;
const MINT = "https://mint.example";
const ORDER_ID = recurringPaymentIdFor("rp-1");
const NOSTR_CONTACT_ID = contactIdFor("contact-1");
const LIGHTNING_CONTACT_ID = contactIdFor("contact-2");
const ENVELOPE_OPERATION = OperationId.make("envelope-op");
const TOKEN = TokenText.make("cashuBenvelope");

const nostrContact: ContactRowLike = {
  id: NOSTR_CONTACT_ID,
  name: "Alice",
  npub: "npub1alice",
};
// Has an npub too: a Lightning-rail order still pays the Lightning address.
const lightningContact: ContactRowLike = {
  id: LIGHTNING_CONTACT_ID,
  name: "Bob",
  npub: "npub1bob",
  lnAddress: "bob@example.com",
};

const int = PositiveInt.orThrow;
const text = NonEmptyString100.orThrow;
const progressColumn = (runCount: number, nextDueAtSec: number) =>
  NonEmptyString1000.orThrow(
    recurringProgressColumn({ runCount, nextDueAtSec }),
  );

const keyOf = (runIndex: number) => recurringEnvelopeKey(ORDER_ID, runIndex);
const refOf = (runIndex: number) => ({ mint: MINT, key: keyOf(runIndex) });

const stateOf = (status: EnvelopeStatus, amount = 100) =>
  new EnvelopeState({
    status,
    amount: NonNegativeAmount.make(amount),
    operationId: status === "absent" ? null : ENVELOPE_OPERATION,
  });

/** What the mint holds per run index; `open` funds an absent run unspent. */
const fakeMint = (statuses: Record<number, EnvelopeStatus> = {}) =>
  new Map(
    Object.entries(statuses).map(([runIndex, status]) => [
      keyOf(Number(runIndex)),
      status,
    ]),
  );

const makeEnvelopes = (
  mint: Map<string, EnvelopeStatus> = fakeMint(),
  overrides: Partial<CashuEnvelopes> = {},
): CashuEnvelopes => ({
  open: vi.fn<CashuEnvelopes["open"]>(async ({ key, amountSat }) => {
    const funded = mint.has(key);
    if (!funded) mint.set(key, "unspent");
    return Either.right(
      new EnvelopeOpened({
        outcome: funded ? "adopted" : "created",
        operationId: ENVELOPE_OPERATION,
        amount: Amount.make(amountSat),
      }),
    );
  }),
  state: vi.fn<CashuEnvelopes["state"]>(async ({ key }) =>
    Either.right(stateOf(mint.get(key) ?? "absent")),
  ),
  send: vi.fn<CashuEnvelopes["send"]>(async () =>
    Either.right(
      new EnvelopeToken({
        operationId: ENVELOPE_OPERATION,
        tokenText: TOKEN,
        amount: Amount.make(100),
      }),
    ),
  ),
  melt: vi.fn<CashuEnvelopes["melt"]>(async () =>
    Either.right(
      new MeltReceipt({
        mint: MintUrl.make(MINT),
        quoteId: QuoteId.make("quote-1"),
        paidAmount: Amount.make(100),
        feeReserve: NonNegativeAmount.make(2),
        feePaid: NonNegativeAmount.make(1),
        changeAmount: NonNegativeAmount.make(1),
      }),
    ),
  ),
  release: vi.fn<CashuEnvelopes["release"]>(async () =>
    Either.right(new EnvelopeReleased({ amount: NonNegativeAmount.make(99) })),
  ),
  ...overrides,
});

const envelopeKeyOf = (runIndex: number) => EnvelopeKey.make(keyOf(runIndex));

/** Envelopes whose first run another context holds. */
const heldEnvelopes = () =>
  makeEnvelopes(fakeMint(), {
    open: vi.fn(async () =>
      Either.left(
        new EnvelopeBusy({ mint: MintUrl.make(MINT), key: envelopeKeyOf(0) }),
      ),
    ),
  });

interface RowOverrides {
  amount?: number;
  contactId?: ReturnType<typeof contactIdFor>;
  lastRunAtSec?: number;
  lastRunStatus?: string;
  nextDueAtSec?: number;
  note?: string;
  rail?: RecurringRail;
  runCount?: number;
  unit?: string;
}

const insertOrder = (
  repository: RecurringPaymentsRepository,
  overrides: RowOverrides = {},
): void => {
  const nextDueAtSec = overrides.nextDueAtSec ?? DUE;
  Effect.runSync(
    repository.insert({
      id: ORDER_ID,
      createdAtSec: int(DUE - HOUR),
      contactId: overrides.contactId ?? NOSTR_CONTACT_ID,
      mintUrl: NonEmptyString1000.orThrow(MINT),
      rail: text(overrides.rail ?? "cashu"),
      amount: int(overrides.amount ?? 100),
      unit: text(overrides.unit ?? "sat"),
      intervalUnit: text("hour"),
      intervalCount: int(6),
      anchorAtSec: int(DUE),
      timeZone: text("UTC"),
      progress: progressColumn(overrides.runCount ?? 0, nextDueAtSec),
      ...(overrides.note === undefined
        ? {}
        : { note: NonEmptyString1000.orThrow(overrides.note) }),
      ...(overrides.lastRunAtSec === undefined
        ? {}
        : { lastRunAtSec: int(overrides.lastRunAtSec) }),
      ...(overrides.lastRunStatus === undefined
        ? {}
        : { lastRunStatus: text(overrides.lastRunStatus) }),
    }),
  );
};

/** The stored row with its progress spread out as `runCount` and `nextDueAtSec`. */
const readRow = (repository: RecurringPaymentsRepository) => {
  const row = Effect.runSync(repository.byId(ORDER_ID));
  const record = row === null ? null : normalizeRecurringPayment(row);
  const order = record === null ? null : readRecurringPaymentOrder(record);
  if (row === null || order === null) throw new Error("unreadable row");
  return { ...row, ...order.schedule };
};

const makeParams = (
  repository: RecurringPaymentsRepository,
  overrides: Partial<Params> = {},
): Params => ({
  contacts: [nostrContact, lightningContact],
  envelopes: makeEnvelopes(),
  fiatRates: null,
  formatDisplayedAmountParts: (amountSat) => ({
    amountText: String(amountSat),
    approxPrefix: "",
    unitLabel: "sat",
  }),
  hydrated: true,
  logPaymentEvent: vi.fn(),
  maybeShowPwaNotification: vi.fn(async () => {}),
  mintBalances: [{ mint: MINT, amount: 1_000 }],
  pushToast: vi.fn(),
  repository,
  sendTokenMessage: vi.fn(async () => ({ status: "sent" as const })),
  showPaidOverlay: vi.fn(),
  t: (key) => key,
  dependencies: {
    // Background by default: the countdown is a separate scenario.
    isVisible: () => false,
    nowSec: () => NOW,
  },
  ...overrides,
});

const Probe = ({
  onRender,
  params,
}: {
  onRender: (scheduler: Scheduler) => void;
  params: Params;
}) => {
  onRender(useRecurringPaymentsScheduler(params));
  return null;
};

// Repository reads and writes run through Effect fibers, which resolve over
// several macrotasks, not just microtasks.
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

const newRepository = () =>
  makeRecurringPaymentsRepository(makeTestLinkyStore().store);

const mount = async (
  rows: RowOverrides | null = {},
  overrides: Partial<Params> = {},
  repository: RecurringPaymentsRepository = newRepository(),
) => {
  if (rows !== null) insertOrder(repository, rows);
  let params = makeParams(repository, overrides);
  let scheduler: Scheduler | null = null;
  const probe = () => (
    <Probe
      params={params}
      onRender={(value) => {
        scheduler = value;
      }}
    />
  );
  const view = await renderIntoDocument(probe());
  await settle();
  const current = (): Scheduler => {
    if (scheduler === null) throw new Error("scheduler not ready");
    return scheduler;
  };
  const envelopes = (): CashuEnvelopes => {
    if (params.envelopes === null) throw new Error("no envelopes");
    return params.envelopes;
  };
  return {
    ...view,
    envelopes,
    params,
    repository,
    row: () => readRow(repository),
    scheduler: current,
    setParams: async (next: Partial<Params>) => {
      params = { ...params, ...next };
      await view.rerender(probe());
    },
    runNow: async () => {
      await act(async () => {
        await current().runNow();
      });
      await settle();
    },
  };
};

const firstRef = refOf(0);

afterEach(() => {
  vi.clearAllMocks();
});

const opened = (view: { envelopes: () => CashuEnvelopes }) =>
  vi.mocked(view.envelopes().open).mock.calls.map(([args]) => args.key);

const deferred = <A,>() => {
  let resolve: (value: A) => void = () => undefined;
  const promise = new Promise<A>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("useRecurringPaymentsScheduler", () => {
  it("pays nothing before the due time and pays on the first pass at it", async () => {
    let now = DUE - 1;
    const view = await mount(
      {},
      { dependencies: { isVisible: () => false, nowSec: () => now } },
    );
    expect(view.envelopes().open).not.toHaveBeenCalled();
    expect(view.params.maybeShowPwaNotification).not.toHaveBeenCalled();

    now = DUE;
    await view.runNow();
    expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
    await view.unmount();
  });

  it("funds the run's envelope and sends its token over the chat", async () => {
    const view = await mount({});

    expect(view.envelopes().open).toHaveBeenCalledWith({
      ...firstRef,
      amountSat: 100,
    });
    expect(view.envelopes().send).toHaveBeenCalledWith({
      ...firstRef,
      memo: null,
    });
    expect(view.params.sendTokenMessage).toHaveBeenCalledWith({
      amount: 100,
      clientId: expect.any(String),
      contactId: NOSTR_CONTACT_ID,
      contactNpub: "npub1alice",
      mint: MINT,
      tokenText: TOKEN,
    });
    expect(view.params.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          recurringPaymentId: ORDER_ID,
          recurringDueAtSec: DUE,
        }),
        method: "cashu_chat",
        status: "ok",
      }),
    );
    expect(view.row()).toMatchObject({
      lastRunAtSec: NOW,
      lastRunStatus: "paid",
      nextDueAtSec: DUE + 6 * HOUR,
      runCount: 1,
    });
    expect(view.params.showPaidOverlay).toHaveBeenCalledWith("paidSentTo", {
      direction: "out",
      amountSat: 100,
      contact: { name: "Alice", npub: "npub1alice" },
    });
    expect(view.scheduler().dueConfirmation).toBeNull();
    await view.unmount();
  });

  it("carries the order's note as the token memo and the history note", async () => {
    const view = await mount({ note: "Rent" });

    expect(view.envelopes().send).toHaveBeenCalledWith({
      ...firstRef,
      memo: "Rent",
    });
    expect(view.params.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "cashu_chat",
        paymentType: "recurring",
        note: "Rent",
      }),
    );
    await view.unmount();
  });

  it("carries the order's note as the LUD-12 comment and the history note", async () => {
    const view = await mount({
      contactId: LIGHTNING_CONTACT_ID,
      note: "Rent",
      rail: "lightning",
    });

    expect(fetchLnurlInvoiceMock).toHaveBeenCalledWith(
      "bob@example.com",
      100,
      "Rent",
    );
    expect(view.params.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "lightning_address",
        paymentType: "recurring",
        note: "Rent",
      }),
    );
    await view.unmount();
  });

  it("sends the same message id for the same run every time", async () => {
    const clientIds: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const view = await mount({});
      const [message] = vi.mocked(view.params.sendTokenMessage).mock.calls[0];
      clientIds.push(message.clientId);
      await view.unmount();
    }
    expect(clientIds[0]).toBe(clientIds[1]);
    expect(clientIds[0]).not.toContain(ORDER_ID);
  });

  it("keeps a run whose message no relay took yet unpaid, so a replacement device completes it", async () => {
    const mint = fakeMint();
    const first = await mount(
      {},
      {
        envelopes: makeEnvelopes(mint),
        sendTokenMessage: vi.fn(async () => ({ status: "queued" as const })),
      },
    );
    expect(first.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    expect(first.params.logPaymentEvent).not.toHaveBeenCalled();
    expect(first.params.showPaidOverlay).not.toHaveBeenCalled();
    await first.unmount();

    const replacement = await mount(
      null,
      { envelopes: makeEnvelopes(mint) },
      first.repository,
    );

    expect(opened(replacement)).toEqual([keyOf(0)]);
    expect(replacement.envelopes().send).toHaveBeenCalledWith({
      ...firstRef,
      memo: null,
    });
    expect(replacement.params.sendTokenMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: vi.mocked(first.params.sendTokenMessage).mock.calls[0][0]
          .clientId,
        tokenText: TOKEN,
      }),
    );
    expect(replacement.row()).toMatchObject({
      lastRunStatus: "paid",
      runCount: 1,
    });
    await replacement.unmount();
  });

  it("converts a fiat payment at the current rate and waits without one", async () => {
    const czk = { amount: 15_000, unit: "czk" };
    const waiting = await mount(czk);
    expect(waiting.envelopes().open).not.toHaveBeenCalled();
    expect(waiting.params.pushToast).toHaveBeenCalledWith(
      "recurringWaitingForRates",
    );
    await waiting.unmount();

    const rates = {
      brlPerBtc: 600_000,
      chfPerBtc: 90_000,
      czkPerBtc: 2_000_000,
      eurPerBtc: 100_000,
      fetchedAtMs: 1,
      usdPerBtc: 110_000,
    };
    const paying = await mount(czk, {
      fiatRates: rates,
      mintBalances: [{ mint: MINT, amount: 10_000 }],
    });
    expect(paying.envelopes().open).toHaveBeenCalledWith({
      ...firstRef,
      amountSat: 7_500,
    });
    await paying.unmount();
  });

  it("delivers a funded fiat envelope without an exchange rate", async () => {
    const view = await mount(
      { amount: 15_000, unit: "czk" },
      { envelopes: makeEnvelopes(fakeMint({ 0: "unspent" })) },
    );
    expect(view.envelopes().send).toHaveBeenCalledTimes(1);
    expect(view.row()).toMatchObject({ lastRunStatus: "paid" });
    expect(view.params.pushToast).not.toHaveBeenCalledWith(
      "recurringWaitingForRates",
    );
    await view.unmount();
  });

  it("melts the envelope for an invoice of its amount on the Lightning rail", async () => {
    const view = await mount({
      contactId: LIGHTNING_CONTACT_ID,
      rail: "lightning",
    });

    expect(fetchLnurlInvoiceMock).toHaveBeenCalledWith(
      "bob@example.com",
      100,
      undefined,
    );
    expect(view.envelopes().melt).toHaveBeenCalledWith({
      ...firstRef,
      invoice: "lnbc-mock-100",
    });
    expect(view.params.sendTokenMessage).not.toHaveBeenCalled();
    expect(view.params.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "lightning_address",
        phase: "complete",
        status: "ok",
      }),
    );
    expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
    expect(view.params.showPaidOverlay).toHaveBeenCalled();
    await view.unmount();
  });

  it("counts an envelope already spent as paid without delivering it again", async () => {
    const view = await mount(
      {},
      {
        envelopes: makeEnvelopes(fakeMint({ 0: "spent" })),
      },
    );

    expect(view.envelopes().send).not.toHaveBeenCalled();
    expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
    expect(view.params.showPaidOverlay).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("waits while the mint has not settled the envelope's melt", async () => {
    const view = await mount(
      {
        contactId: LIGHTNING_CONTACT_ID,
        rail: "lightning",
      },
      {
        envelopes: makeEnvelopes(fakeMint(), {
          melt: vi.fn(async () =>
            Either.left(
              new PaymentPending({
                mint: MintUrl.make(MINT),
                quoteId: QuoteId.make("quote-1"),
                operationId: OperationId.make("melt-op"),
                amount: Amount.make(100),
              }),
            ),
          ),
        }),
      },
    );

    expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    expect(view.params.logPaymentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ method: "lightning_address", phase: "melt" }),
    );
    expect(view.params.pushToast).not.toHaveBeenCalled();
    expect(view.params.showPaidOverlay).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("waits while a melt of the envelope is in flight", async () => {
    const view = await mount(
      {},
      {
        envelopes: makeEnvelopes(fakeMint({ 0: "pending" })),
      },
    );

    expect(view.envelopes().send).not.toHaveBeenCalled();
    expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    await view.unmount();
  });

  it("stops and asks for attention when the envelope is partly spent", async () => {
    const view = await mount(
      {},
      {
        envelopes: makeEnvelopes(fakeMint({ 0: "mixed" })),
      },
    );

    expect(view.envelopes().send).not.toHaveBeenCalled();
    expect(view.row()).toMatchObject({ lastRunStatus: "failed", runCount: 0 });
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringNeedsAttentionCashu",
    );
    await view.unmount();
  });

  it("keeps the run due and tells the user when delivery fails", async () => {
    const view = await mount(
      {},
      {
        sendTokenMessage: vi.fn(async () => ({
          status: "failed" as const,
          error: "relay down",
        })),
      },
    );

    expect(view.row()).toMatchObject({
      lastRunAtSec: NOW,
      lastRunStatus: "failed",
      nextDueAtSec: DUE,
      runCount: 0,
    });
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringRunFailedToast",
    );
    expect(view.params.maybeShowPwaNotification).toHaveBeenCalledWith(
      "recurringPaymentTitle",
      "recurringFailedBody",
      `recurring-failed:${ORDER_ID}:${DUE}`,
    );
    expect(view.params.showPaidOverlay).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("writes nothing while another context holds the envelope", async () => {
    const view = await mount(
      {},
      {
        envelopes: heldEnvelopes(),
      },
    );

    expect(view.envelopes().open).toHaveBeenCalledTimes(1);
    expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    await view.unmount();
  });

  it("leaves the run to another device that took the envelope meanwhile", async () => {
    const view = await mount(
      {},
      {
        envelopes: makeEnvelopes(fakeMint(), {
          send: vi.fn(async () =>
            Either.left(
              new EnvelopeNotFound({
                mint: MintUrl.make(MINT),
                key: envelopeKeyOf(0),
              }),
            ),
          ),
        }),
      },
    );

    expect(view.params.sendTokenMessage).not.toHaveBeenCalled();
    expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    expect(view.params.pushToast).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("fetches no new invoice every pass while a melt record holds the envelope", async () => {
    let now = NOW;
    const view = await mount(
      {
        contactId: LIGHTNING_CONTACT_ID,
        rail: "lightning",
      },
      {
        dependencies: {
          isVisible: () => false,
          nowSec: () => now,
        },
        envelopes: makeEnvelopes(fakeMint(), {
          melt: vi.fn(async () =>
            Either.left(
              new EnvelopeNotFound({
                mint: MintUrl.make(MINT),
                key: envelopeKeyOf(0),
              }),
            ),
          ),
        }),
      },
    );
    expect(fetchLnurlInvoiceMock).toHaveBeenCalledTimes(1);

    await view.runNow();
    expect(fetchLnurlInvoiceMock).toHaveBeenCalledTimes(1);

    now += RECURRING_RUN_RETRY_DELAY_SEC;
    await view.runNow();
    expect(fetchLnurlInvoiceMock).toHaveBeenCalledTimes(2);
    expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    await view.unmount();
  });

  it("waits for funds at the order's mint and tells the user once", async () => {
    const view = await mount(
      { amount: 500 },
      {
        mintBalances: [
          { mint: MINT, amount: 100 },
          { mint: "https://other.example", amount: 5_000 },
        ],
      },
    );
    await view.runNow();

    expect(view.envelopes().open).not.toHaveBeenCalled();
    expect(view.params.pushToast).toHaveBeenCalledTimes(1);
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringWaitingForFunds",
    );
    expect(view.params.maybeShowPwaNotification).toHaveBeenCalledTimes(1);
    expect(view.params.maybeShowPwaNotification).toHaveBeenCalledWith(
      "recurringPaymentTitle",
      "recurringWaitingForFundsBody",
      `recurring-waiting:${ORDER_ID}:${DUE}`,
    );
    await view.unmount();
  });

  it("waits for funds when the balance covers the amount but not the fee", async () => {
    const view = await mount(
      {},
      {
        envelopes: makeEnvelopes(fakeMint(), {
          open: vi.fn(async () =>
            Either.left(
              new InsufficientFunds({
                mint: MintUrl.make(MINT),
                required: Amount.make(100),
                available: NonNegativeAmount.make(100),
              }),
            ),
          ),
        }),
        mintBalances: [{ mint: MINT, amount: 100 }],
      },
    );
    await view.runNow();

    expect(view.envelopes().open).toHaveBeenCalledTimes(1);
    expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    expect(view.params.pushToast).toHaveBeenCalledTimes(1);
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringWaitingForFunds",
    );
    await view.unmount();
  });

  it("waits for funds when the balance does not cover a Lightning melt's fee reserve", async () => {
    const view = await mount(
      {
        contactId: LIGHTNING_CONTACT_ID,
        rail: "lightning",
      },
      {
        envelopes: makeEnvelopes(fakeMint(), {
          melt: vi.fn(async () =>
            Either.left(
              new InsufficientFunds({
                mint: MintUrl.make(MINT),
                required: Amount.make(2),
                available: NonNegativeAmount.make(0),
              }),
            ),
          ),
        }),
      },
    );

    expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    expect(view.params.pushToast).toHaveBeenCalledTimes(1);
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringWaitingForFunds",
    );
    await view.unmount();
  });

  it("asks the mint about the run's envelope once per retry delay while funds are short", async () => {
    let now = NOW;
    const view = await mount(
      { amount: 500 },
      {
        dependencies: {
          isVisible: () => false,
          nowSec: () => now,
        },
        mintBalances: [],
      },
    );
    // Once by recovery, once before waiting.
    expect(view.envelopes().state).toHaveBeenCalledTimes(2);
    expect(view.envelopes().state).toHaveBeenCalledWith(firstRef);
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringWaitingForFunds",
    );

    await view.runNow();
    expect(view.envelopes().state).toHaveBeenCalledTimes(2);

    now += RECURRING_RUN_RETRY_DELAY_SEC;
    await view.runNow();
    expect(view.envelopes().state).toHaveBeenCalledTimes(3);
    expect(view.envelopes().open).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("pays from an envelope the mint already holds although the balance is short", async () => {
    const view = await mount(
      { amount: 500 },
      {
        envelopes: makeEnvelopes(fakeMint({ 0: "unspent" })),
        mintBalances: [],
      },
    );

    // The envelope holds 100 sat; it pays that, not the order's 500.
    expect(view.envelopes().open).toHaveBeenCalledWith({
      ...firstRef,
      amountSat: 100,
    });
    expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
    expect(view.params.pushToast).not.toHaveBeenCalledWith(
      "recurringWaitingForFunds",
    );
    await view.unmount();
  });

  it("counts a run whose envelope was spent before a restart as paid instead of waiting", async () => {
    const view = await mount(
      { amount: 500 },
      {
        envelopes: makeEnvelopes(fakeMint({ 0: "spent" })),
        mintBalances: [],
      },
    );

    expect(view.envelopes().send).not.toHaveBeenCalled();
    expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
    expect(view.params.pushToast).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("counts a run found spent on startup as paid without announcing it", async () => {
    const view = await mount(
      {},
      { envelopes: makeEnvelopes(fakeMint({ 0: "spent" })) },
    );

    expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
    expect(view.envelopes().send).not.toHaveBeenCalled();
    expect(view.params.maybeShowPwaNotification).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("counts a spent run as paid although its contact is gone", async () => {
    const view = await mount(
      { contactId: contactIdFor("contact-x") },
      { envelopes: makeEnvelopes(fakeMint({ 0: "spent" })) },
    );

    expect(view.envelopes().open).not.toHaveBeenCalled();
    expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
    expect(view.params.pushToast).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("waits for a run in flight instead of skipping it when its contact is gone", async () => {
    const view = await mount(
      { contactId: contactIdFor("contact-x") },
      { envelopes: makeEnvelopes(fakeMint({ 0: "pending" })) },
    );

    expect(view.envelopes().open).not.toHaveBeenCalled();
    expect(view.row()).toMatchObject({
      lastRunStatus: null,
      nextDueAtSec: DUE,
      runCount: 0,
    });
    expect(view.params.pushToast).not.toHaveBeenCalled();
    await view.unmount();
  });

  it("skips a period still unfunded at the next due time and notifies", async () => {
    const view = await mount({
      amount: 5_000,
      nextDueAtSec: DUE - 6 * HOUR,
    });

    expect(view.row()).toMatchObject({ lastRunStatus: "skipped", runCount: 0 });
    expect(view.params.maybeShowPwaNotification).toHaveBeenCalledWith(
      "recurringPaymentTitle",
      "recurringSkippedNoFundsBody",
      `recurring-skipped:${ORDER_ID}:${DUE - 6 * HOUR}`,
    );
    await view.unmount();
  });

  it("skips a period whose payment kept failing and notifies", async () => {
    const view = await mount({
      nextDueAtSec: DUE - 6 * HOUR,
      lastRunAtSec: DUE - HOUR,
      lastRunStatus: "failed",
    });

    expect(view.row()).toMatchObject({ lastRunStatus: "skipped" });
    expect(view.envelopes().open).not.toHaveBeenCalled();
    expect(view.params.maybeShowPwaNotification).toHaveBeenCalledWith(
      "recurringPaymentTitle",
      "recurringSkippedFailingBody",
      `recurring-skipped:${ORDER_ID}:${DUE - 6 * HOUR}`,
    );
    await view.unmount();
  });

  it("skips a payment whose contact is gone without funding anything", async () => {
    const view = await mount({
      contactId: contactIdFor("contact-x"),
    });

    expect(view.envelopes().open).not.toHaveBeenCalled();
    expect(view.row()).toMatchObject({
      lastRunAtSec: NOW,
      lastRunStatus: "skipped",
      nextDueAtSec: DUE + 6 * HOUR,
      runCount: 0,
    });
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringRecipientUnavailable",
    );
    expect(view.params.maybeShowPwaNotification).toHaveBeenCalledWith(
      "recurringPaymentTitle",
      "recurringSkippedRecipientBody",
      `recurring-skipped:${ORDER_ID}:${DUE}`,
    );
    await view.unmount();
  });

  it("does nothing while the runtime is not composed", async () => {
    const view = await mount({}, { envelopes: null });
    expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
    await view.unmount();
  });

  describe("while Linky is visible", () => {
    const visible = {
      isVisible: () => true,
      nowSec: () => NOW,
    };

    it("shows the countdown instead of paying", async () => {
      const view = await mount(
        {},
        {
          dependencies: visible,
        },
      );

      expect(view.envelopes().open).not.toHaveBeenCalled();
      expect(view.scheduler().dueConfirmation).toEqual({
        orderId: ORDER_ID,
        runIndex: 0,
        dueAtSec: DUE,
        amountSat: 100,
        sendAtSec: NOW + RECURRING_CONFIRM_SEC,
      });
      expect(view.row()).toMatchObject({ lastRunStatus: null });

      // Another pass keeps the running countdown instead of restarting it.
      await view.runNow();
      expect(view.scheduler().dueConfirmation?.sendAtSec).toBe(
        NOW + RECURRING_CONFIRM_SEC,
      );
      await view.unmount();
    });

    it("pays when the user confirms", async () => {
      const view = await mount(
        {},
        {
          dependencies: visible,
        },
      );
      await act(async () => {
        await view.scheduler().confirmDueNow();
      });
      await settle();

      expect(view.envelopes().open).toHaveBeenCalledTimes(1);
      expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
      expect(view.scheduler().dueConfirmation).toBeNull();
      await view.unmount();
    });

    it("tells the user when another context holds the envelope on confirm", async () => {
      const view = await mount(
        {},
        {
          dependencies: visible,
          envelopes: heldEnvelopes(),
        },
      );
      await act(async () => {
        await view.scheduler().confirmDueNow();
      });
      await settle();

      expect(view.params.pushToast).toHaveBeenCalledWith("recurringWalletBusy");
      expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });
      await view.unmount();
    });

    it("pays a run whose envelope the mint already signed without a countdown", async () => {
      const view = await mount(
        { amount: 500 },
        {
          dependencies: visible,
          envelopes: makeEnvelopes(fakeMint({ 0: "spent" })),
          mintBalances: [],
        },
      );

      expect(view.scheduler().dueConfirmation).toBeNull();
      expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
      await view.unmount();
    });

    it("does not count down again for a run already in delivery", async () => {
      const view = await mount(
        {},
        {
          dependencies: visible,
          sendTokenMessage: vi.fn(async () => ({ status: "queued" as const })),
        },
      );
      await act(async () => {
        await view.scheduler().confirmDueNow();
      });
      await settle();
      expect(view.row()).toMatchObject({ lastRunStatus: null, runCount: 0 });

      await view.setParams({
        sendTokenMessage: vi.fn(async () => ({ status: "sent" as const })),
      });
      await view.runNow();

      expect(view.scheduler().dueConfirmation).toBeNull();
      expect(view.row()).toMatchObject({ lastRunStatus: "paid", runCount: 1 });
      await view.unmount();
    });

    it("pays the run the countdown showed, also after another tab paid it", async () => {
      const mint = fakeMint();
      const view = await mount(
        {},
        {
          dependencies: visible,
          envelopes: makeEnvelopes(mint),
        },
      );
      expect(view.scheduler().dueConfirmation).toMatchObject({ runIndex: 0 });
      mint.set(keyOf(0), "spent");
      Effect.runSync(
        view.repository.update(ORDER_ID, {
          progress: progressColumn(1, DUE + 6 * HOUR),
        }),
      );
      await act(async () => {
        await view.scheduler().confirmDueNow();
      });
      await settle();

      expect(opened(view)).toEqual([keyOf(0)]);
      expect(view.envelopes().send).not.toHaveBeenCalled();
      expect(view.row()).toMatchObject({
        nextDueAtSec: DUE + 6 * HOUR,
        runCount: 1,
      });
      await view.unmount();
    });

    it("skips the period when the user cancels", async () => {
      const view = await mount(
        {},
        {
          dependencies: visible,
        },
      );
      await act(async () => {
        await view.scheduler().cancelDue();
      });
      await settle();

      expect(view.envelopes().open).not.toHaveBeenCalled();
      expect(view.row()).toMatchObject({
        lastRunAtSec: NOW,
        lastRunStatus: "skipped",
        nextDueAtSec: DUE + 6 * HOUR,
        runCount: 0,
      });
      expect(view.params.pushToast).toHaveBeenCalledWith(
        "recurringCancelledToast",
      );
      expect(view.params.maybeShowPwaNotification).not.toHaveBeenCalledWith(
        "recurringPaymentTitle",
        expect.stringMatching(/^recurringSkipped/),
        expect.anything(),
      );
      expect(view.scheduler().dueConfirmation).toBeNull();
      await view.unmount();
    });

    it("counts a run another device paid meanwhile as paid instead of skipping it on cancel", async () => {
      const mint = fakeMint();
      const view = await mount(
        {},
        {
          dependencies: visible,
          envelopes: makeEnvelopes(mint),
        },
      );
      mint.set(keyOf(0), "spent");
      await act(async () => {
        await view.scheduler().cancelDue();
      });
      await settle();

      expect(view.envelopes().send).not.toHaveBeenCalled();
      expect(view.row()).toMatchObject({
        lastRunStatus: "paid",
        nextDueAtSec: DUE + 6 * HOUR,
        runCount: 1,
      });
      expect(view.params.pushToast).toHaveBeenCalledWith(
        "recurringCancelTooLate",
      );
      expect(view.params.pushToast).not.toHaveBeenCalledWith(
        "recurringCancelledToast",
      );
      await view.unmount();
    });
  });

  it("does not skip the next period when the countdown's run was delivered elsewhere", async () => {
    // Another device sent the token and counted the run; the contact has
    // not redeemed it yet, so the envelope is still unspent.
    const mint = fakeMint();
    const view = await mount(
      {},
      {
        dependencies: {
          isVisible: () => true,
          nowSec: () => NOW,
        },
        envelopes: makeEnvelopes(mint),
      },
    );
    mint.set(keyOf(0), "unspent");
    Effect.runSync(
      view.repository.update(
        ORDER_ID,
        recurringPaymentUpdate({
          lastRunStatus: "paid",
          progress: recurringProgressColumn({
            runCount: 1,
            nextDueAtSec: DUE + 6 * HOUR,
          }),
        }),
      ),
    );
    await act(async () => {
      await view.scheduler().cancelDue();
    });
    await settle();

    expect(view.row()).toMatchObject({
      lastRunStatus: "paid",
      nextDueAtSec: DUE + 6 * HOUR,
      runCount: 1,
    });
    expect(view.params.pushToast).toHaveBeenCalledWith(
      "recurringCancelTooLate",
    );
    expect(view.params.pushToast).not.toHaveBeenCalledWith(
      "recurringCancelledToast",
    );
    await view.unmount();
  });

  describe("envelope recovery", () => {
    const later = { nextDueAtSec: DUE + 5 * HOUR };

    it("checks each order's envelopes once, and all again on request", async () => {
      const view = await mount({ ...later, runCount: 2 });
      expect(view.envelopes().state).toHaveBeenCalledTimes(1);
      expect(view.envelopes().state).toHaveBeenCalledWith(refOf(2));

      await view.runNow();
      expect(view.envelopes().state).toHaveBeenCalledTimes(1);

      await act(async () => {
        await view.scheduler().recoverEnvelopes();
      });
      expect(view.envelopes().state).toHaveBeenCalledTimes(2);
      expect(view.envelopes().release).not.toHaveBeenCalled();
      await view.unmount();
    });

    it("asks an unreachable mint again only after the retry delay", async () => {
      let now = NOW;
      const view = await mount(later, {
        dependencies: {
          isVisible: () => false,
          nowSec: () => now,
        },
        envelopes: makeEnvelopes(fakeMint(), {
          state: vi.fn(async () =>
            Either.left(
              new MintUnreachable({ mint: MintUrl.make(MINT), detail: null }),
            ),
          ),
        }),
      });
      expect(view.envelopes().state).toHaveBeenCalledTimes(1);

      await view.runNow();
      expect(view.envelopes().state).toHaveBeenCalledTimes(1);

      now += RECURRING_RUN_RETRY_DELAY_SEC;
      await view.runNow();
      expect(view.envelopes().state).toHaveBeenCalledTimes(2);
      await view.unmount();
    });

    it("reports a restore done only after a fresh walk, also while a pass is running", async () => {
      const relay = deferred<{ status: "sent" }>();
      const view = await mount(
        {},
        {
          sendTokenMessage: vi.fn(() => relay.promise),
        },
      );
      const walksBefore = vi.mocked(view.envelopes().state).mock.calls.length;
      let restored = false;
      const restoring = view
        .scheduler()
        .recoverEnvelopes()
        .then(() => {
          restored = true;
        });
      await settle();
      expect(restored).toBe(false);

      relay.resolve({ status: "sent" });
      await act(async () => {
        await restoring;
      });
      expect(restored).toBe(true);
      // The fresh walk starts at the run the finished pass paid.
      expect(view.envelopes().state).toHaveBeenLastCalledWith(refOf(1));
      expect(
        vi.mocked(view.envelopes().state).mock.calls.length,
      ).toBeGreaterThan(walksBefore);
      await view.unmount();
    });

    it.each(["unspent", "mixed"] as const)(
      "releases the %s envelope of a Lightning payment deleted after startup",
      async (status) => {
        const view = await mount(
          { ...later, contactId: LIGHTNING_CONTACT_ID, rail: "lightning" },
          { envelopes: makeEnvelopes(fakeMint({ 0: status })) },
        );
        expect(view.envelopes().release).not.toHaveBeenCalled();

        Effect.runSync(view.repository.remove(ORDER_ID));
        await view.runNow();
        expect(view.envelopes().release).toHaveBeenCalledWith(firstRef);
        expect(view.params.sendTokenMessage).not.toHaveBeenCalled();
        await view.unmount();
      },
    );

    it("settles an envelope funded above a count a stale edit moved back", async () => {
      // Run 0 was paid and run 1 funded before a crash; a stale edit then
      // restored the count to 0 and the order was deleted.
      const view = await mount(
        { ...later, contactId: LIGHTNING_CONTACT_ID, rail: "lightning" },
        { envelopes: makeEnvelopes(fakeMint({ 0: "spent", 1: "unspent" })) },
      );
      Effect.runSync(view.repository.remove(ORDER_ID));
      await view.runNow();

      expect(view.envelopes().release).toHaveBeenCalledTimes(1);
      expect(view.envelopes().release).toHaveBeenCalledWith(refOf(1));
      expect(view.envelopes().state).toHaveBeenLastCalledWith(refOf(2));
      await view.unmount();
    });

    it("delivers the token of a deleted Cashu payment instead of releasing it, and says so", async () => {
      const view = await mount(later, {
        envelopes: makeEnvelopes(fakeMint({ 0: "unspent" })),
      });
      Effect.runSync(view.repository.remove(ORDER_ID));
      await view.runNow();

      expect(view.envelopes().release).not.toHaveBeenCalled();
      expect(view.envelopes().send).toHaveBeenCalledWith({
        ...firstRef,
        memo: null,
      });
      expect(view.params.sendTokenMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          contactNpub: "npub1alice",
          tokenText: TOKEN,
        }),
      );
      expect(view.params.maybeShowPwaNotification).toHaveBeenCalledWith(
        "recurringPaymentTitle",
        "recurringDeletedTokenSentBody",
        `recurring-deleted-delivered:${keyOf(0)}`,
      );
      expect(reportAppLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ tag: "recurring.deletedTokenDelivered" }),
      );
      await view.unmount();
    });

    it("keeps a deleted Cashu payment's token until its contact turns up, telling the user once", async () => {
      let now = NOW;
      const view = await mount(later, {
        contacts: [lightningContact],
        dependencies: {
          isVisible: () => false,
          nowSec: () => now,
        },
        envelopes: makeEnvelopes(fakeMint({ 0: "unspent" })),
      });
      Effect.runSync(view.repository.remove(ORDER_ID));
      await view.runNow();
      now += RECURRING_RUN_RETRY_DELAY_SEC;
      await view.runNow();

      expect(view.envelopes().send).not.toHaveBeenCalled();
      expect(view.envelopes().release).not.toHaveBeenCalled();
      const kept = vi
        .mocked(view.params.maybeShowPwaNotification)
        .mock.calls.filter(
          ([, body]) => body === "recurringDeletedTokenKeptBody",
        );
      expect(kept).toHaveLength(1);
      expect(reportAppLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ tag: "recurring.deletedTokenKept" }),
      );

      await view.setParams({ contacts: [nostrContact, lightningContact] });
      now += RECURRING_RUN_RETRY_DELAY_SEC;
      await view.runNow();
      expect(view.envelopes().send).toHaveBeenCalledWith({
        ...firstRef,
        memo: null,
      });
      expect(view.params.sendTokenMessage).toHaveBeenCalledWith(
        expect.objectContaining({ contactNpub: "npub1alice" }),
      );
      await view.unmount();
    });

    it("keeps a deleted Cashu payment's partly spent token, telling the user once and checking again later", async () => {
      let now = NOW;
      const view = await mount(later, {
        contacts: [lightningContact],
        dependencies: {
          isVisible: () => false,
          nowSec: () => now,
        },
        envelopes: makeEnvelopes(fakeMint({ 0: "mixed" })),
      });
      Effect.runSync(view.repository.remove(ORDER_ID));
      await view.runNow();
      const checks = vi.mocked(view.envelopes().state).mock.calls.length;
      now += RECURRING_RUN_RETRY_DELAY_SEC;
      await view.runNow();

      expect(
        vi.mocked(view.envelopes().state).mock.calls.length,
      ).toBeGreaterThan(checks);
      expect(view.envelopes().send).not.toHaveBeenCalled();
      expect(view.envelopes().release).not.toHaveBeenCalled();
      const kept = vi
        .mocked(view.params.maybeShowPwaNotification)
        .mock.calls.filter(
          ([, body]) => body === "recurringDeletedTokenPartlySpentBody",
        );
      expect(kept).toHaveLength(1);
      expect(reportAppLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ tag: "recurring.deletedTokenKept" }),
      );
      await view.unmount();
    });
  });
});
