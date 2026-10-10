import { useAtomSet, useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import {
  emptyProfileCache,
  profileCacheAtom,
  type ProfileCache,
} from "../../state/contacts/profiles";

type SetCacheField<K extends keyof ProfileCache> = React.Dispatch<
  React.SetStateAction<ProfileCache[K]>
>;

/** The profile cache with a `useState`-style setter per map. */
export const useProfileCache = () => {
  const cache = useAtomValue(profileCacheAtom);
  const setCache = useAtomSet(profileCacheAtom);
  const setters = React.useMemo(() => {
    const setterFor =
      <K extends keyof ProfileCache>(field: K): SetCacheField<K> =>
      (action) =>
        setCache((current) => {
          const next =
            typeof action === "function" ? action(current[field]) : action;
          return next === current[field]
            ? current
            : { ...current, [field]: next };
        });
    return {
      setMetadataByNpub: setterFor("metadataByNpub"),
      setPictureByNpub: setterFor("pictureByNpub"),
      setStatusByNpub: setterFor("statusByNpub"),
    };
  }, [setCache]);
  const reset = React.useCallback(
    () => setCache(emptyProfileCache),
    [setCache],
  );
  return { cache, reset, ...setters };
};
