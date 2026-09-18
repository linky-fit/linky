import * as Evolu from "@evolu/common";
import { Effect } from "effect";
import React, { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import {
  LOCAL_PAYMENT_EVENTS_STORAGE_KEY_PREFIX,
  LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX,
} from "../../utils/constants";
import { createCashuTokenId } from "../lib/cashuTokenIdentity";
import {
  buildTransactionInsertPayload,
  useOwnerScopedStorage,
} from "./useOwnerScopedStorage";

beforeAll(() => {
  vi.stubGlobal("__APP_VERSION__", "test");
});

type OwnerScopedStorage = ReturnType<typeof useOwnerScopedStorage>;
type TransactionInsert = Parameters<
  typeof useOwnerScopedStorage
>[0]["transactions"]["insert"];

interface HookHarnessProps {
  appOwnerId: Evolu.OwnerId;
  insert: TransactionInsert;
  onRender: (storage: OwnerScopedStorage) => void;
}

const HookHarness = ({
  appOwnerId,
  insert,
  onRender,
}: HookHarnessProps): React.ReactElement | null => {
  const appOwnerIdRef = React.useRef<Evolu.OwnerId | null>(appOwnerId);
  onRender(useOwnerScopedStorage({ appOwnerIdRef, transactions: { insert } }));
  return null;
};

const mountedRoots = new Set<Root>();

const parseOwnerId = (value: string): Evolu.OwnerId => {
  const result = Evolu.OwnerId.fromUnknown(value);
  if (!result.ok) {
    throw new Error(`Invalid test owner ID: ${value}`);
  }
  return result.value;
};

const renderStorageHook = async (
  appOwnerId: Evolu.OwnerId,
  insert: TransactionInsert,
): Promise<OwnerScopedStorage> => {
  const resultRef: { current: OwnerScopedStorage | null } = { current: null };
  const { root } = await renderIntoDocument(
    React.createElement(HookHarness, {
      appOwnerId,
      insert,
      onRender: (storage) => {
        resultRef.current = storage;
      },
    }),
  );
  mountedRoots.add(root);

  if (!resultRef.current) {
    throw new Error("Owner-scoped storage hook did not render");
  }
  return resultRef.current;
};

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
  });
  mountedRoots.clear();
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
          lightningMemo: "derived memo",
          rawToken: "cashu-raw",
          requestId: "request-1",
          requestText: "large request payload",
          unknownContactId: "unknown:pubkey",
          usedInputTokens: [usedToken],
        },
        direction: "out",
        fee: 1,
        method: "unknown",
        note: "redundant title",
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

describe("useOwnerScopedStorage", () => {
  const appOwnerId = parseOwnerId("AAAAAAAAAAAAAAAAAAAAAA");

  it("logs transactions through the repository and queues app-owner telemetry", async () => {
    const insert = vi.fn<TransactionInsert>(() => Effect.void);
    const storage = await renderStorageHook(appOwnerId, insert);

    storage.logPaymentEvent({
      amount: 42,
      direction: "out",
      method: "cashu_chat",
      status: "ok",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
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

  it("queues telemetry when the transaction insert fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const insert = vi.fn<TransactionInsert>(() =>
      Effect.die(new Error("history unavailable")),
    );
    const storage = await renderStorageHook(appOwnerId, insert);

    expect(() => {
      storage.logPaymentEvent({
        direction: "in",
        method: "cashu_receive",
        status: "ok",
      });
    }).not.toThrow();
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      localStorage.getItem(
        `${LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX}.${appOwnerId}`,
      ),
    ).not.toBeNull();
  });

  it("migrates valid legacy payments through the repository", async () => {
    const insert = vi.fn<TransactionInsert>(() => Effect.void);
    const storage = await renderStorageHook(appOwnerId, insert);
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

    storage.migrateLegacyPaymentEventsToEvolu(appOwnerId);

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
