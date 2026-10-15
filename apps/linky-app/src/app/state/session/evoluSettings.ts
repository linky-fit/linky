import type { LinkyScope } from "@linky-fit/linksync";
import { Atom } from "effect/reactivity";
import type { EvoluError, EvoluServerStatus } from "../../../evolu";
import { lazyStateAtom } from "../platform";
import { armAtoms } from "../shell/arm";
import { ownerCommandsAtom } from "../shell/ownerCommands";
import { evoluAtom, evoluRelaySettingsAtom } from "./evolu";

export interface EvoluServers {
  readonly configuredUrls: readonly string[];
  readonly disabledUrls: readonly string[];
  readonly statusByUrl: Readonly<Record<string, EvoluServerStatus>>;
  /** The relay list changed; Evolu takes it on the next start. */
  readonly reloadRequired: boolean;
}

/** The device's Evolu relays as Settings shows them, with their last probe. */
export const evoluServersAtom = lazyStateAtom((get): EvoluServers => {
  const settings = get(evoluRelaySettingsAtom);
  return {
    configuredUrls: [...settings.configuredUrls()],
    disabledUrls: [...settings.disabledUrls()],
    statusByUrl: {},
    reloadRequired: false,
  };
});

/** The relay probes may run; until then Settings shows active relays as disconnected. */
export const evoluServerProbesReadyAtom = Atom.keepAlive(Atom.make(false));

/** The error Evolu last reported, as the shell's error watch keeps it. */
export const evoluLastErrorAtom = lazyStateAtom(
  (get): EvoluError | null => get(evoluAtom)?.evolu.getError() ?? null,
);

export interface EvoluDatabaseInfo {
  readonly bytes: number | null;
  readonly tableCounts: Readonly<Record<string, number | null>>;
  readonly historyCount: number | null;
  readonly updatedAtMs: number | null;
}

export const emptyEvoluDatabaseInfo: EvoluDatabaseInfo = {
  bytes: null,
  tableCounts: {},
  historyCount: null,
  updatedAtMs: null,
};

/** The local database's size and row counts, read while an Evolu page shows. */
export const evoluDatabaseInfoAtom = Atom.keepAlive(
  Atom.make<EvoluDatabaseInfo>(emptyEvoluDatabaseInfo),
);

/** The Evolu relay URL typed on the add-relay page. */
export const newEvoluServerUrlAtom = Atom.keepAlive(Atom.make(""));

export const evoluWipeBusyAtom = Atom.keepAlive(Atom.make(false));

/** Clearing the local database was tapped once; a second tap within 5 s clears it. */
export const evoluClearArm = armAtoms<true>(5000);

/** The scope whose shard a manual rotation is starting. */
export const rotatingShardScopeAtom = Atom.keepAlive(
  Atom.make<LinkyScope | null>(null),
);

export interface EvoluStorageCommands {
  /** The user's reset of local Evolu data; refused while a quota error stands. */
  readonly wipeEvoluStorage: () => Promise<void>;
}

export const evoluStorageCommandsAtom =
  ownerCommandsAtom<EvoluStorageCommands>();
