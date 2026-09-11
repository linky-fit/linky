import { Layer } from "effect";
import { Autoswap } from "./autoswap/Autoswap";
import type { Bip39Seed } from "./domain/primitives";
import { FeeProbe } from "./feeProbe/FeeProbe";
import { Melt } from "./melt/Melt";
import { Mints } from "./mint/Mints";
import { CashuSeed } from "./ports/CashuSeed";
import { inMemoryKeyValueStore } from "./ports/inMemoryKeyValueStore";
import { inMemoryOperationStore } from "./ports/inMemoryOperationStore";
import { inMemoryProofStore } from "./ports/inMemoryProofStore";
import type { KeyValueStore } from "./ports/KeyValueStore";
import type { OperationStore } from "./ports/OperationStore";
import type { ProofStore } from "./ports/ProofStore";
import { Receive } from "./receive/Receive";
import { Restore } from "./restore/Restore";
import { Send } from "./send/Send";
import { Tokens } from "./token/Tokens";
import { Topup } from "./topup/Topup";
import { Validation } from "./validation/Validation";

export interface LinkshuServicesConfig {
  readonly bip39Seed: Bip39Seed;
  /** Durable locked key-value storage; defaults to non-durable in-memory. */
  readonly keyValueStore?: Layer.Layer<KeyValueStore> | undefined;
  /** Durable proof inventory; defaults to non-durable in-memory. */
  readonly proofStore?: Layer.Layer<ProofStore> | undefined;
  /** Durable operation records; defaults to non-durable in-memory. */
  readonly operationStore?: Layer.Layer<OperationStore> | undefined;
}

/**
 * The one place that knows how to assemble the vertical services over the
 * ports. Composition roots layer their own environment on top: a react
 * runtime merges the inspector, the headless runner provides the result per
 * call.
 */
export const linkshuServices = (config: LinkshuServicesConfig) =>
  Layer.mergeAll(
    Tokens.Default,
    Receive.Default,
    Send.Default,
    Melt.Default,
    Validation.Default,
    Restore.Default,
    Topup.Default,
    Autoswap.Default,
    FeeProbe.Default,
    Mints.Default,
  ).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        CashuSeed.fromBytes(config.bip39Seed),
        config.keyValueStore ?? inMemoryKeyValueStore,
        config.proofStore ?? inMemoryProofStore,
        config.operationStore ?? inMemoryOperationStore,
      ),
    ),
  );

/** Everything `linkshuServices` provides. */
export type LinkshuServices = Layer.Layer.Success<
  ReturnType<typeof linkshuServices>
>;
