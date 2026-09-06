import { Registry } from "./index";
import {
  ClientId,
  OutboxRef,
  PaymentTelemetryDraft,
  PaymentTelemetryReceipt,
  UnixSeconds,
} from "@linky/linkstr";
import type { OutboxResult } from "@linky/linkstr";
import { stubWrapTransport } from "@linky/linkstr/testing";
import type { SignedWrapEvent } from "@linky/linkstr/testing";
import { Exit } from "effect";
import { linkstrConfigAtom } from "./config";
import { outboxResultsAtom, outboxResultsHandlerAtom } from "./outbox";
import { enqueuePaymentTelemetryAtom } from "./paymentTelemetry";
import { configWith, makeIdentity, settle } from "./testing";

const alice = makeIdentity();
const collector = makeIdentity();

const draft = new PaymentTelemetryDraft({
  id: ClientId.make("telemetry-react"),
  createdAtSec: UnixSeconds.make(1_754_000_000),
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

describe("enqueuePaymentTelemetryAtom", () => {
  it("delivers through the outbox and reports a telemetry receipt", async () => {
    const published: Array<SignedWrapEvent> = [];
    const registry = Registry.make();
    registry.set(
      linkstrConfigAtom,
      configWith(alice, stubWrapTransport(published)),
    );

    const handled: Array<OutboxResult> = [];
    registry.set(outboxResultsHandlerAtom, {
      onResult: async (result) => {
        handled.push(result);
      },
    });
    const unmount = registry.mount(outboxResultsAtom);

    registry.set(enqueuePaymentTelemetryAtom, {
      draft,
      recipient: collector.pubkey,
      ref: OutboxRef.make("telemetry:telemetry-react"),
    });
    const exit = await settle(registry, enqueuePaymentTelemetryAtom);

    expect(Exit.isSuccess(exit)).toBe(true);
    await expect.poll(() => handled.length).toBe(1);
    expect(published).toHaveLength(1);

    const result = handled[0];
    expect(result).toEqual(
      expect.objectContaining({
        _tag: "OutboxJobSucceeded",
        ref: "telemetry:telemetry-react",
      }),
    );
    assert(result?._tag === "OutboxJobSucceeded");
    assert(result.receipt instanceof PaymentTelemetryReceipt);
    expect(result.receipt.clientId).toBe(draft.id);
    unmount();
  });
});
