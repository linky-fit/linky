import type { SettingKey } from "@linky-fit/linksync";
import { Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { resolveAllowTestMints } from "../../lib/testMintGate";
import { changesAtom } from "./live";
import { settingsRepositoryAtom } from "./store";

const settingsChangesAtom = changesAtom(
  settingsRepositoryAtom,
  (settings) => settings.subscribe,
);

/** A synced setting, re-read whenever the settings change. */
export const liveSettingAtom = <K extends SettingKey>(key: K) =>
  Atom.make((get) =>
    Effect.gen(function* () {
      get(settingsChangesAtom);
      const settings = yield* get.result(settingsRepositoryAtom);
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
