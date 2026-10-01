import { Context, Layer } from "effect";
import type { RelayUrl } from "../domain/primitives";

/**
 * One source of truth for where we read and where we write, so the two sets
 * cannot silently diverge per call site.
 */
export interface RelayPolicyService {
  readonly readRelays: ReadonlyArray<RelayUrl>;
  readonly writeRelays: ReadonlyArray<RelayUrl>;
}

export class RelayPolicy extends Context.Service<
  RelayPolicy,
  RelayPolicyService
>()("linkstr/RelayPolicy") {
  static fixed(relays: RelayPolicyService): Layer.Layer<RelayPolicy> {
    return Layer.succeed(RelayPolicy, relays);
  }
}
