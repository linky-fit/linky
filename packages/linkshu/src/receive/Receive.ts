import { Effect } from "effect";
import { Inspector } from "../inspector/Inspector";
import { inspectOperationWith, redactReceipt } from "../internal/operations";
import { WalletInstances } from "../mint/internal/WalletInstances";
import { KeyValueStore } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import type { ReceiveDraft, ReceiveError, ReceiveReceipt } from "./domain";
import { receiveTokenText } from "./internal/acceptFlow";
import type { ReceiveContext } from "./internal/acceptFlow";

/**
 * Receiving a token is one call over the shared accept flow (see
 * `internal/acceptFlow.ts`, which `Tokens.returnToWallet` re-receives
 * through): extraction, decoding, dedup by token text, deterministic
 * re-signing with counter-collision recovery, and lifecycle bookkeeping.
 */
export class Receive extends Effect.Service<Receive>()("linkshu/Receive", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const ctx: ReceiveContext = {
      kv: yield* KeyValueStore,
      tokenStore: yield* TokenStore,
      instances: yield* WalletInstances,
      inspector: yield* Inspector.orNoop,
    };

    const receive = (
      draft: ReceiveDraft,
    ): Effect.Effect<ReceiveReceipt, ReceiveError> =>
      receiveTokenText(ctx, draft.text, null).pipe(
        // Params stay empty: the only input is token text (proof secrets).
        inspectOperationWith(
          ctx.inspector,
          "receive.receive",
          {},
          redactReceipt,
        ),
      );

    return { receive } as const;
  }),
}) {}
