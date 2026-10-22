import { AppData, AppDataQuery, type Pubkey } from "@linky-fit/linkstr";
import { linkstrRuntimeAtom } from "@linky-fit/linkstr-react";
import {
  ONCHAIN_CONFIG_IDENTIFIER,
  type OnchainConfig,
} from "@linky-fit/onchain-transfer";
import { Effect, Stream } from "effect";
import { onchainOperator } from "../../lib/onchainOperator";
import { newestOnchainConfig } from "../../lib/onchainTransfers";

export type OnchainConfigState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly config: OnchainConfig };

export const watchOnchainConfig = (operator: Pubkey) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const appData = yield* AppData;
      const query = new AppDataQuery({
        authors: [operator],
        identifiers: [ONCHAIN_CONFIG_IDENTIFIER],
      });
      const state = (
        events: Parameters<typeof newestOnchainConfig>[0],
      ): OnchainConfigState => {
        const config = newestOnchainConfig(events, operator);
        return config === null
          ? { status: "unavailable" }
          : { status: "ready", config };
      };
      const initial = appData.fetch(query).pipe(
        Effect.map(state),
        Effect.catch(() =>
          Effect.succeed<OnchainConfigState>({ status: "unavailable" }),
        ),
      );
      const updates = yield* appData.watch(query);
      return Stream.concat(
        Stream.fromEffect(initial),
        updates.pipe(Stream.map((event) => state([event]))),
      );
    }),
  );

/** Restarts with the Nostr runtime, including when boot replaces its initial config. */
export const onchainConfigAtom = linkstrRuntimeAtom.atom(() =>
  onchainOperator === null
    ? Stream.succeed<OnchainConfigState>({ status: "unavailable" })
    : watchOnchainConfig(onchainOperator.pubkey),
);
