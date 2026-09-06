import React from "react";

interface UseStoragePersistRequestEffectParams {
  refreshKey: unknown;
}

export const useStoragePersistRequestEffect = ({
  refreshKey,
}: UseStoragePersistRequestEffectParams): void => {
  React.useEffect(() => {
    const storage = navigator.storage;
    if (!storage?.persisted || !storage.persist) return;

    let cancelled = false;
    void (async () => {
      try {
        const persisted = await storage.persisted();
        if (cancelled || persisted) return;

        await storage.persist();
        if (cancelled) return;

        await storage.persisted();
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
};
