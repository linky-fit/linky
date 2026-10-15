import { AtomRegistry, scheduleTask } from "@linky-fit/linkstr-react";
import type { EvoluPlatform, PlatformPorts } from "../platform/ports";
import type { SessionState } from "../platform/session";
import { evoluPlatformAtom, platformAtom } from "./state/platform";
import { sessionAtom } from "./state/session/session";

/**
 * The page's atom registry, with the settings of atom-react's default one.
 * main.tsx provides it through `RegistryContext`, so code outside React reads
 * the same atoms.
 */
export const makeAppRegistry = ({
  ports,
  session,
  evoluPlatform,
}: {
  readonly ports: PlatformPorts;
  readonly session: SessionState;
  readonly evoluPlatform: EvoluPlatform | null;
}): AtomRegistry.AtomRegistry =>
  AtomRegistry.make({
    scheduleTask,
    defaultIdleTTL: 400,
    initialValues: [
      [platformAtom, ports],
      [evoluPlatformAtom, evoluPlatform],
      [sessionAtom, session],
    ],
  });

export { RegistryContext } from "@linky-fit/linkstr-react";
