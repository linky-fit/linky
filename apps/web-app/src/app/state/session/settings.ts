import type { SettingKey } from "@linky-fit/linksync";
import { Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { resolveAllowTestMints } from "../../lib/testMintGate";
import { settingsRepositoryAtom } from "./store";

/** A synced setting, re-read whenever the settings change. */
const liveSettingAtom = <K extends SettingKey>(key: K) =>
  Atom.make((get) =>
    Effect.gen(function* () {
      const settings = yield* get.result(settingsRepositoryAtom);
      // As in walletReadModelAtom: a refresh inside the store's notify loop would re-notify forever.
      get.addFinalizer(
        settings.subscribe(() => queueMicrotask(() => get.refreshSelf())),
      );
      return yield* settings.get(key);
    }),
  );

const allowTestMintsSettingAtom = liveSettingAtom("allowTestMints");

/** The synced "Allow test mints" preference; unset (or not read yet) follows the build default. */
export const allowTestMintsAtom = Atom.readable((get) =>
  resolveAllowTestMints(
    Option.getOrNull(AsyncResult.value(get(allowTestMintsSettingAtom))),
  ),
);
