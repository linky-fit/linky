import { Effect } from "effect";
import type { Layer } from "effect";
import { linkshuServices } from "./composition";
import type { LinkshuServices } from "./composition";
import type { Bip39Seed } from "./domain/primitives";
import { Inspector } from "./inspector/Inspector";
import type { KeyValueStore } from "./ports/KeyValueStore";
import type { OperationStore } from "./ports/OperationStore";
import type { ProofStore } from "./ports/ProofStore";

export interface LinkshuHeadlessConfig {
  readonly bip39Seed: Bip39Seed;
  /** Omitting the stores runs on non-durable in-memory defaults. */
  readonly keyValueStore?: Layer.Layer<KeyValueStore> | undefined;
  readonly proofStore?: Layer.Layer<ProofStore> | undefined;
  readonly operationStore?: Layer.Layer<OperationStore> | undefined;
  /** Omitting it disables diagnostics; see `Inspector`. */
  readonly inspector?: Layer.Layer<Inspector> | undefined;
}

/**
 * Promise-facing one-shot runner for non-React/non-Effect callers (the CLI
 * wallet, scripts, tests): builds the services fresh, runs the effect, and
 * tears everything down again.
 */
export const runLinkshu = <A, E>(
  config: LinkshuHeadlessConfig,
  effect: Effect.Effect<A, E, LinkshuServices>,
): Promise<A> =>
  Effect.runPromise(
    // Outside the service layer, because the vertical services read the
    // inspector while that layer is being built.
    Effect.provide(
      Effect.provide(effect, linkshuServices(config)),
      config.inspector ?? Inspector.disabled,
    ),
  );
