import * as Evolu from "@evolu/common";
import { OutboxJobId } from "@linky/linkstr";
import type { EnqueuePaymentTelemetryParams } from "@linky/linkstr-react";
import { Exit } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX } from "../../utils/constants";
import type { LocalPaymentTelemetryEvent } from "../types/appTypes";

type EnqueuePaymentTelemetry = (
  params: EnqueuePaymentTelemetryParams,
) => Promise<Exit.Exit<OutboxJobId, { readonly _tag: string }>>;

const { enqueuePaymentTelemetryMock } = vi.hoisted(() => ({
  enqueuePaymentTelemetryMock: vi.fn<EnqueuePaymentTelemetry>(),
}));

vi.mock("@linky/linkstr-react", () => ({
  enqueuePaymentTelemetryAtom: "enqueuePaymentTelemetryAtom",
  useAtomSet: () => enqueuePaymentTelemetryMock,
}));

import { useAnonymousPaymentTelemetry } from "./useAnonymousPaymentTelemetry";

const APP_OWNER_ID = Evolu.OwnerId.orThrow("AQEBAQEBAQEBAQEBAQEBAQ");
const storageKey = `${LOCAL_PENDING_PAYMENT_TELEMETRY_STORAGE_KEY_PREFIX}.${APP_OWNER_ID}`;

const pendingEvent = (id: string): LocalPaymentTelemetryEvent => ({
  id,
  createdAtSec: 1_754_000_000,
  direction: "out",
  status: "ok",
  method: "lightning_invoice",
  phase: "complete",
  mint: null,
  amountBucket: "lte_100",
  feeBucket: null,
  errorCode: null,
  errorDetail: null,
  appHost: null,
  devicePlatform: null,
  appRuntime: null,
  appVersion: "26.9.0",
});

const readBuffer = (): ReadonlyArray<LocalPaymentTelemetryEvent> =>
  JSON.parse(localStorage.getItem(storageKey) ?? "[]");

const mount = async (): Promise<void> => {
  const Harness = () => {
    useAnonymousPaymentTelemetry({
      appOwnerId: APP_OWNER_ID,
      makeLocalStorageKey: (prefix) => `${prefix}.${APP_OWNER_ID}`,
    });
    return null;
  };
  await renderIntoDocument(<Harness />);
  await act(async () => {
    await Promise.resolve();
  });
};

describe("useAnonymousPaymentTelemetry", () => {
  afterEach(() => {
    enqueuePaymentTelemetryMock.mockReset();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("enqueues each pending event once and clears the buffer", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify([pendingEvent("event-1"), pendingEvent("event-2")]),
    );
    enqueuePaymentTelemetryMock.mockResolvedValue(
      Exit.succeed(OutboxJobId.make("job-1")),
    );

    await mount();

    expect(enqueuePaymentTelemetryMock).toHaveBeenCalledTimes(2);
    const [first, second] = enqueuePaymentTelemetryMock.mock.calls;
    expect(first?.[0].draft.id).toBe("event-1");
    expect(first?.[0].ref).toBe("telemetry:event-1");
    expect(second?.[0].draft.id).toBe("event-2");
    expect(readBuffer()).toEqual([]);
  });

  it("keeps events the outbox did not accept", async () => {
    localStorage.setItem(storageKey, JSON.stringify([pendingEvent("event-1")]));
    enqueuePaymentTelemetryMock.mockResolvedValue(
      Exit.fail({ _tag: "RuntimeNotReady" }),
    );

    await mount();

    expect(enqueuePaymentTelemetryMock).toHaveBeenCalledTimes(1);
    expect(readBuffer().map((event) => event.id)).toEqual(["event-1"]);
  });
});
