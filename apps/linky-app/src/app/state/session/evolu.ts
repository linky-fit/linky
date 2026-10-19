import type { AppOwner } from "@linky-fit/linksync";
import {
  createLinkyEvolu,
  makeEvoluRelaySettings,
  type LinkyEvolu,
  type OwnerSync,
} from "@linky-fit/linksync/evolu";
import { Atom } from "effect/reactivity";
import { loadRecommendedRelays } from "../../../utils/recommendedRelays";
import { evoluPlatformAtom, platformAtom } from "../platform";
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
  readonly ownerSync: OwnerSync;
  readonly appOwner: AppOwner | null;
  readonly hasEvoluRelay: boolean;
}

/**
 * The session's database, opened once per page load: Evolu cannot be
 * disposed, so a later session change never reopens it. `null` while signed out.
 */
export const evoluAtom = Atom.keepAlive(
  Atom.make((get): OpenedEvolu | null => {
    const secrets = sessionSecrets(get.once(sessionAtom));
    if (secrets === null) return null;
    const platform = get.once(evoluPlatformAtom);
    if (platform === null)
      throw new Error("A signed-in session needs the Evolu platform");
    const transports = get
      .once(evoluRelaySettingsAtom)
      .activeUrls()
      .map((url) => ({ type: "WebSocket" as const, url }));
    return {
      ...createLinkyEvolu({
        ...platform,
        mnemonic: secrets.appMnemonic,
        transports,
        onEvent: reportLinkyEvoluEvent,
      }),
      hasEvoluRelay: transports.length > 0,
    };
  }),
);
