import { useAtomSet } from "@linky-fit/linkstr-react";
import type { Atom } from "effect/reactivity";
import React from "react";
import { useLatest } from "../../../hooks/useLatest";
import type { OwnerCommands } from "../../state/shell/ownerCommands";

/** Hands the owner's latest `commands` to every screen that reads `atom`. */
export const useProvideOwnerCommands = <C>(
  atom: Atom.Writable<OwnerCommands<C> | null>,
  commands: C,
): void => {
  const latest = useLatest(commands);
  const setCommands = useAtomSet(atom);
  React.useEffect(() => {
    setCommands({ read: () => latest.current });
    return () => setCommands(null);
  }, [latest, setCommands]);
};
