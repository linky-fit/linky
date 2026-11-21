import type { OwnerId } from "@linky-fit/linksync";
import {
  makeEvoluRelaySettings,
  openLinkyEvolu,
  type EvoluRun,
  type LinkyEvolu,
} from "@linky-fit/linksync/evolu";
import { Atom, type AtomRegistry } from "effect/reactivity";
import { loadRecommendedRelays } from "../../../utils/recommendedRelays";
import { platformAtom } from "../platform";
import { reportLinkyEvoluEvent } from "./evoluInspector";
import { sessionAtom, sessionSecrets } from "./session";

/**
 * The device's Evolu relay list. Built once per page load, signed in or not,
 * because building it runs the one-time storage migration.
 */
export const evoluRelaySettingsAtom = Atom.keepAlive(
  Atom.make((get) => {
    const { kv, config } = get.once(platformAtom);
    return makeEvoluRelaySettings(kv, {
      envDefaults: config.evoluRelayDefaults,
      recommended: loadRecommendedRelays().evolu,
      hasStoredAccount:
        sessionSecrets(get.once(sessionAtom))?.appMnemonic != null,
      onEvent: reportLinkyEvoluEvent,
    });
  }),
);

export interface OpenedEvolu {
  readonly evolu: LinkyEvolu;
  readonly run: EvoluRun;
  readonly hasEvoluRelay: boolean;
  readonly onOwnerDeleted: (listener: (ownerId: OwnerId) => void) => () => void;
}

/** The session's database, set once per page load by `openSessionEvolu`; `null` while signed out. */
export const evoluAtom = Atom.keepAlive(Atom.make<OpenedEvolu | null>(null));

/** Thrown when secure storage could not say which account this device holds. */
export class AppMnemonicUnreadable extends Error {
  constructor() {
    super("Secure storage did not return the account key; reload to retry");
  }
}

/**
 * Opens the signed-in session's database and keeps it in `evoluAtom`. A
 * session whose app mnemonic secure storage could not read opens nothing,
 * since any database it opened would belong to another owner.
 */
export const openSessionEvolu = async (
  registry: AtomRegistry.AtomRegistry,
  run: EvoluRun,
  { memoryOnly }: { readonly memoryOnly: boolean },
): Promise<OpenedEvolu> => {
  const session = registry.get(sessionAtom);
  const secrets = sessionSecrets(session);
  if (secrets === null) throw new Error("Only a signed-in session opens Evolu");
  if (
    session._tag === "SignedIn" &&
    session.degraded &&
    session.unreadable.has("appMnemonic")
  )
    throw new AppMnemonicUnreadable();
  const relayUrls = registry.get(evoluRelaySettingsAtom).activeUrls();
  const ownerDeletedListeners = new Set<(ownerId: OwnerId) => void>();
  const evolu = await openLinkyEvolu(run, {
    mnemonic: secrets.appMnemonic,
    relayUrls,
    memoryOnly,
    onOwnerDeleted: (ownerId) => {
      for (const listener of ownerDeletedListeners) listener(ownerId);
    },
  });
  const opened: OpenedEvolu = {
    evolu,
    run,
    hasEvoluRelay: relayUrls.length > 0,
    onOwnerDeleted: (listener) => {
      ownerDeletedListeners.add(listener);
      return () => {
        ownerDeletedListeners.delete(listener);
      };
    },
  };
  registry.set(evoluAtom, opened);
  return opened;
};
