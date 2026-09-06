import * as Evolu from "@evolu/common";
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
type EvoluInsert = Parameters<typeof useOwnerScopedStorage>[0]["insert"];

interface HookHarnessProps {
  appOwnerId: Evolu.OwnerId;
  insert: EvoluInsert;
  onRender: (storage: OwnerScopedStorage) => void;
  transactionsOwnerId: Evolu.OwnerId;
}

const HookHarness = ({
  appOwnerId,
  insert,
  onRender,
  transactionsOwnerId,
}: HookHarnessProps): React.ReactElement | null => {
  const appOwnerIdRef = React.useRef<Evolu.OwnerId | null>(appOwnerId);
  const transactionsOwnerIdRef = React.useRef<Evolu.OwnerId | null>(
    transactionsOwnerId,
  );
  onRender(
    useOwnerScopedStorage({
      appOwnerIdRef,
      insert,
      transactionsOwnerIdRef,
    }),
  );
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
  transactionsOwnerId: Evolu.OwnerId,
  insert: EvoluInsert,
): Promise<OwnerScopedStorage> => {
  const resultRef: { current: OwnerScopedStorage | null } = { current: null };
  const { root } = await renderIntoDocument(
    React.createElement(HookHarness, {
      appOwnerId,
      insert,
      onRender: (storage) => {
        resultRef.current = storage;
      },
      transactionsOwnerId,
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
  const transactionsOwnerId = parseOwnerId("AQEBAQEBAQEBAQEBAQEBAQ");

  it("logs transactions to their owner lane and queues app-owner telemetry", async () => {
    const insert = vi.fn<EvoluInsert>();
    const storage = await renderStorageHook(
      appOwnerId,
      transactionsOwnerId,
      insert,
    );

    storage.logPaymentEvent({
      amount: 42,
      direction: "out",
      method: "cashu_chat",
      status: "ok",
    });

    expect(insert).toHaveBeenCalledWith(
      "transaction",
      expect.objectContaining({
        amount: 42,
        direction: "out",
        method: "cashu_chat",
        status: "ok",
      }),
      { ownerId: transactionsOwnerId },
    );
    expect(
      localStorage.getItem(
        `${LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX}.${appOwnerId}`,
      ),
    ).not.toBeNull();
  });

  it("queues telemetry when transaction insertion throws", async () => {
    const insert = vi.fn<EvoluInsert>(() => {
      throw new Error("history unavailable");
    });
    const storage = await renderStorageHook(
      appOwnerId,
      transactionsOwnerId,
      insert,
    );

    expect(() => {
      storage.logPaymentEvent({
        direction: "in",
        method: "cashu_receive",
        status: "ok",
      });
    }).not.toThrow();
    expect(
      localStorage.getItem(
        `${LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX}.${appOwnerId}`,
      ),
    ).not.toBeNull();
  });

  it("migrates valid legacy payments to the supplied transaction owner lane", async () => {
    const insert = vi.fn<EvoluInsert>();
    const storage = await renderStorageHook(
      appOwnerId,
      transactionsOwnerId,
      insert,
    );
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

    storage.migrateLegacyPaymentEventsToEvolu(appOwnerId, transactionsOwnerId);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      "transaction",
      {
        amount: 120,
        createdAtSec: 456,
        direction: "in",
        method: "cashu_receive",
        mint: "https://mint.example",
        status: "ok",
        unit: "sat",
      },
      { ownerId: transactionsOwnerId },
    );
    expect(localStorage.getItem(`${legacyStorageKey}.migratedToEvolu.v2`)).toBe(
      "1",
    );
  });
});
