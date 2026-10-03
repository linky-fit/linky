import { Schema } from "effect";
import { Pubkey, RumorId, UnixSeconds } from "../domain/primitives";
import { SupporterResult } from "./domain";

/** `from` answered your token message `tokenMessageId`. Awards are not verified yet. */
export class SupporterResultReceived extends Schema.TaggedClass<SupporterResultReceived>()(
  "SupporterResultReceived",
  {
    resultId: RumorId,
    from: Pubkey,
    tokenMessageId: RumorId,
    result: SupporterResult,
    sentAt: UnixSeconds,
  },
) {}

export const SupporterResultInboxEvent = Schema.Union(SupporterResultReceived);
export type SupporterResultInboxEvent = typeof SupporterResultInboxEvent.Type;
