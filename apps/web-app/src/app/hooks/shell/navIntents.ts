import {
  RegistryContext,
  useAtomSet,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import React from "react";
import { navIntentsAtom, type NavIntents } from "../../state/shell/navIntents";

/** Sets one navigation intent without subscribing to it. */
export const useSetNavIntent = <K extends keyof NavIntents>(key: K) => {
  const setIntents = useAtomSet(navIntentsAtom);
  return React.useCallback(
    (value: NavIntents[K]) =>
      setIntents((intents) =>
        intents[key] === value ? intents : { ...intents, [key]: value },
      ),
    [key, setIntents],
  );
};

export const useNavIntent = <K extends keyof NavIntents>(key: K) =>
  useAtomValue(navIntentsAtom, (intents) => intents[key]);

/** Reads one navigation intent at call time, for effects that must not rerun when it changes. */
export const useReadNavIntent = <K extends keyof NavIntents>(key: K) => {
  const registry = React.useContext(RegistryContext);
  return React.useCallback(
    (): NavIntents[K] => registry.get(navIntentsAtom)[key],
    [key, registry],
  );
};
