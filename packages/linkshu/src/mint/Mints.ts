import { Effect } from "effect";
import type { MintRejected, MintUnreachable } from "../domain/errors";
import type { MintUrl } from "../domain/primitives";
import { Inspector } from "../inspector/Inspector";
import { inspectOperation } from "../internal/operations";
import { KeyValueStore } from "../ports/KeyValueStore";
import { TokenStore } from "../ports/TokenStore";
import { findMintInfoIconValue, isTestMintUrl } from "./icons";
import { MintInfo } from "./domain";
import { collectKnownMints } from "./internal/knownMints";
import { boundKeysetInputFeePpk } from "./internal/keysetFees";
import { WalletInstances } from "./internal/WalletInstances";
import type { LoadedWallet } from "./internal/WalletInstances";
import { sat } from "../internal/units";

const nullableString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const buildMintInfo = (mint: MintUrl, wallet: LoadedWallet): MintInfo => {
  const published = wallet.getMintInfo();
  const raw = published.cache;
  const advertisedInfo = JSON.stringify(raw).toLowerCase();
  return new MintInfo({
    url: mint,
    name: nullableString(raw.name),
    inputFeePpk: boundKeysetInputFeePpk(wallet),
    supportsMpp: published.isSupported(15).supported,
    isFakeLightning:
      isTestMintUrl(mint) ||
      advertisedInfo.includes("fakewallet") ||
      advertisedInfo.includes(
        "all your lightning invoices will always be marked paid",
      ),
    iconUrl: (() => {
      const icon = findMintInfoIconValue(raw, new Set());
      if (!icon) return null;
      try {
        return new URL(icon, mint).toString();
      } catch {
        return null;
      }
    })(),
  });
};

/**
 * Mint knowledge. Also the home of the package's single wallet-instance
 * cache (one loaded cashu-ts wallet per mint+unit, shared by every
 * vertical) — that cache is internal and never part of this interface,
 * because raw cashu-ts types do not cross the public boundary.
 */
export class Mints extends Effect.Service<Mints>()("linkshu/Mints", {
  dependencies: [WalletInstances.Default],
  effect: Effect.gen(function* () {
    const kv = yield* KeyValueStore;
    const tokenStore = yield* TokenStore;
    const instances = yield* WalletInstances;
    const inspector = yield* Inspector.orNoop;

    /** Fetch and normalize the mint's published info and keyset fees. */
    const info = (
      mint: MintUrl,
    ): Effect.Effect<MintInfo, MintUnreachable | MintRejected> =>
      instances.get(mint, sat).pipe(
        Effect.map((wallet) => buildMintInfo(mint, wallet)),
        inspectOperation(inspector, "mints.info", { mint }),
      );

    /** Every mint the wallet has state for: stored rows plus seen mints. */
    const knownMints: Effect.Effect<ReadonlyArray<MintUrl>> = collectKnownMints(
      kv,
      tokenStore,
    );

    return { info, knownMints } as const;
  }),
}) {}
