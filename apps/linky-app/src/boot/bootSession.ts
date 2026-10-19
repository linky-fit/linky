import type { AtomRegistry } from "@linky-fit/linkstr-react";
import { makeAppRegistry } from "../app/registry";
import {
  evoluAtom,
  evoluRelaySettingsAtom,
  type OpenedEvolu,
} from "../app/state/session/evolu";
import type { EvoluPlatform, PlatformPorts } from "../platform/ports";
import {
  loadSession,
  mirrorPushNsec,
  type SessionState,
} from "../platform/session";

export interface BootedSession {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly session: SessionState;
  /** Null unless the session is signed in. */
  readonly opened: OpenedEvolu | null;
}

/**
 * Reads the stored session and builds the app's atom registry, opening the
 * local database only for a signed-in session. Runs after a pending logout
 * has been wiped, so it never reads the identity being logged out.
 */
export const bootSession = async ({
  ports,
  makeEvoluPlatform,
}: {
  readonly ports: PlatformPorts;
  readonly makeEvoluPlatform: () => Promise<EvoluPlatform>;
}): Promise<BootedSession> => {
  const session = await loadSession(ports);
  mirrorPushNsec(session);
  console.log("[linky][boot] session loaded", { session: session._tag });

  const evoluPlatform =
    session._tag === "SignedIn" ? await makeEvoluPlatform() : null;
  const registry = makeAppRegistry({ ports, session, evoluPlatform });
  // Built on every boot: building it migrates the stored relay list once.
  registry.get(evoluRelaySettingsAtom);
  const opened = registry.get(evoluAtom);
  console.log("[linky][boot] evolu loaded", { opened: opened !== null });
  return { registry, session, opened };
};
