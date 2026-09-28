import { Outbox } from "@linky-fit/linkstr";
import type {
  OutboxRef,
  PaymentTelemetryDraft,
  Pubkey,
} from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export interface EnqueuePaymentTelemetryParams {
  readonly draft: PaymentTelemetryDraft;
  readonly recipient: Pubkey;
  readonly ref: OutboxRef;
}

/** Durable send: the outbox owns delivery, retries and the terminal result. */
export const enqueuePaymentTelemetryAtom =
  linkstrRuntimeAtom.fn<EnqueuePaymentTelemetryParams>()((params) =>
    Effect.flatMap(Outbox, (outbox) =>
      outbox.enqueueTelemetry(params.draft, params.recipient, params.ref),
    ),
  );
