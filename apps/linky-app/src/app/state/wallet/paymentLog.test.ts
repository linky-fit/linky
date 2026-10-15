// @vitest-environment jsdom
import {
  NonEmptyString,
  NonEmptyString100,
  OwnerId,
  PositiveInt,
  transactionIdForRequest,
  type TransactionRow,
  type TransactionsRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  LOCAL_PAYMENT_EVENTS_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX,
} from "../../../utils/constants";
import { localStorageKv } from "../../../utils/storage";
import { createCashuTokenId } from "../../lib/cashuTokenIdentity";
import { buildTransactionInsertPayload, makePaymentLog } from "./paymentLog";

beforeAll(() => {
  vi.stubGlobal("__APP_VERSION__", "test");
});

type Transactions = Pick<TransactionsRepository, "byId" | "insert" | "update">;
type TransactionInsert = Transactions["insert"];

const parseOwnerId = (value: string): OwnerId => {
  const result = OwnerId.fromUnknown(value);
  if (!result.ok) {
    throw new Error(`Invalid test owner ID: ${value}`);
  }
  return result.value;
};

const paymentLogOver = (
  appOwnerId: OwnerId,
  insert: TransactionInsert,
  overrides: Partial<Transactions> = {},
) =>
  makePaymentLog({
    kv: localStorageKv,
    ownerId: appOwnerId,
    transactions: {
      byId: () => Effect.succeed(null),
      insert,
      update: () => Effect.void,
      ...overrides,
    },
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("buildTransactionInsertPayload", () => {
  it("stores one canonical classification and compact token references", () => {
    const usedToken = "cashu-used";
    const gainedToken = "cashu-gained";
    const payload = buildTransactionInsertPayload({
      createdAtSec: 123,
      event: {
        amount: 21,
        details: {
          acceptedToken: gainedToken,
          lightningInvoice: "lnbc1invoice",
          rawToken: "cashu-raw",
          requestId: "request-1",
          requestText: "large request payload",
          unknownContactId: "unknown:pubkey",
          usedInputTokens: [usedToken],
        },
        direction: "out",
        fee: 1,
        method: "unknown",
        note: "  coffee  ",
        phase: "swap",
        status: "ok",
      },
    });

    expect(payload).toEqual({
      amount: 21,
      createdAtSec: 123,
      detailsJson: JSON.stringify({
        requestId: "request-1",
        lightningInvoice: "lnbc1invoice",
        usedTokenIds: [createCashuTokenId(usedToken)],
        gainedTokenIds: [createCashuTokenId(gainedToken)],
      }),
      direction: "out",
      fee: 1,
      method: "cashu_emit",
      note: "coffee",
      status: "ok",
    });
  });

  it("stores publish-phase events as pending", () => {
    expect(
      buildTransactionInsertPayload({
        createdAtSec: 456,
        event: {
          direction: "out",
          method: "cashu_chat",
          phase: "publish",
          status: "ok",
        },
      }),
    ).toEqual({
      createdAtSec: 456,
      direction: "out",
      method: "cashu_chat",
      status: "pending",
    });
  });

  it("stores an ok melt step as pending and keeps the melt quote id", () => {
    expect(
      buildTransactionInsertPayload({
        createdAtSec: 456,
        event: {
          amount: 40,
          details: { lightningInvoice: "lnbc1invoice", meltQuoteId: "quote-1" },
          direction: "out",
          method: "lightning_invoice",
          mint: "https://mint.example",
          phase: "melt",
          status: "ok",
        },
      }),
    ).toEqual({
      amount: 40,
      createdAtSec: 456,
      detailsJson: JSON.stringify({
        lightningInvoice: "lnbc1invoice",
        meltQuoteId: "quote-1",
      }),
      direction: "out",
      method: "lightning_invoice",
      mint: "https://mint.example",
      status: "pending",
    });
  });

  it("omits a zero fee", () => {
    expect(
      buildTransactionInsertPayload({
        createdAtSec: 789,
        event: {
          direction: "out",
          fee: 0,
          method: "lightning_invoice",
          status: "ok",
        },
      }),
    ).toEqual({
      createdAtSec: 789,
      direction: "out",
      method: "lightning_invoice",
      status: "ok",
    });
  });
});

describe("makePaymentLog", () => {
  const appOwnerId = parseOwnerId("AAAAAAAAAAAAAAAAAAAAAA");

  it("logs transactions through the repository and queues app-owner telemetry", async () => {
    const insert = vi.fn<TransactionInsert>(() => Effect.void);
    const storage = paymentLogOver(appOwnerId, insert);

    const transactionId = transactionIdForRequest("request-1");
    storage.logPaymentEvent({
      amount: 42,
      direction: "out",
      method: "cashu_chat",
      status: "ok",
      transactionId,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: transactionId,
        amount: 42,
        direction: "out",
        method: "cashu_chat",
        status: "ok",
      }),
    );
    expect(
      localStorage.getItem(
        `${LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX}.${appOwnerId}`,
      ),
    ).not.toBeNull();
  });

  it("merges a repeated write into the existing row", async () => {
    const insert = vi.fn<TransactionInsert>(() => Effect.void);
    const update = vi.fn<Transactions["update"]>(() => Effect.void);
    const transactionId = transactionIdForRequest("request-1");
    const existing: TransactionRow = {
      id: transactionId,
      ownerId: appOwnerId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      isDeleted: null,
      createdAtSec: PositiveInt.orThrow(100),
      direction: NonEmptyString100.orThrow("out"),
      status: NonEmptyString100.orThrow("ok"),
      amount: null,
      fee: null,
      method: null,
      note: null,
      detailsJson: NonEmptyString.orThrow(JSON.stringify({ requestId: "r" })),
      iconKind: null,
      contactId: null,
      mint: null,
      unit: null,
      error: null,
      pendingLabel: null,
    };
    const storage = paymentLogOver(appOwnerId, insert, {
      byId: () => Effect.succeed(existing),
      update,
    });

    storage.logPaymentEvent({
      direction: "out",
      details: { lightningInvoice: "lnbc1" },
      method: "cashu_chat",
      phase: "publish",
      status: "ok",
      transactionId,
    });
    await settle();

    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(transactionId, {
      createdAtSec: 100,
      direction: "out",
      method: "cashu_chat",
      detailsJson: JSON.stringify({
        requestId: "r",
        lightningInvoice: "lnbc1",
      }),
    });
  });

  it("records no transaction for a failure, only telemetry", async () => {
    const insert = vi.fn<TransactionInsert>(() => Effect.void);
    const storage = paymentLogOver(appOwnerId, insert);

    storage.logPaymentEvent({
      direction: "in",
      error: "Token already spent",
      method: "cashu_receive",
      status: "error",
    });

    expect(insert).not.toHaveBeenCalled();
    expect(
      localStorage.getItem(
        `${LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX}.${appOwnerId}`,
      ),
    ).not.toBeNull();
  });

  it("queues telemetry when the transaction insert fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const insert = vi.fn<TransactionInsert>(() =>
      Effect.die(new Error("history unavailable")),
    );
    const storage = paymentLogOver(appOwnerId, insert);

    expect(() => {
      storage.logPaymentEvent({
        direction: "in",
        method: "cashu_receive",
        status: "ok",
        transactionId: transactionIdForRequest("request-1"),
      });
    }).not.toThrow();
    await settle();
    expect(
      localStorage.getItem(
        `${LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX}.${appOwnerId}`,
      ),
    ).not.toBeNull();
  });

  it("migrates valid legacy payments through the repository", async () => {
    const insert = vi.fn<TransactionInsert>(() => Effect.void);
    const storage = paymentLogOver(appOwnerId, insert);
    const legacyStorageKey = `${LOCAL_PAYMENT_EVENTS_STORAGE_KEY_PREFIX}.${appOwnerId}`;
    localStorage.setItem(
      legacyStorageKey,
      JSON.stringify([
        {
          amount: 120,
          contactId: null,
          createdAtSec: 456,
          direction: "in",
          error: null,
          fee: null,
          id: "legacy-valid",
          method: "cashu_receive",
          mint: "https://mint.example",
          phase: "receive",
          status: "ok",
          unit: "sat",
        },
        {
          createdAtSec: "invalid",
          direction: "in",
          status: "ok",
        },
      ]),
    );

    storage.migrateLegacyPaymentEvents();

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      id: expect.any(String),
      amount: 120,
      createdAtSec: 456,
      direction: "in",
      method: "cashu_receive",
      mint: "https://mint.example",
      status: "ok",
      unit: "sat",
    });
    expect(localStorage.getItem(`${legacyStorageKey}.migratedToEvolu.v2`)).toBe(
      "1",
    );
  });
});
