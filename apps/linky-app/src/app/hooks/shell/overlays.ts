import { useAtomSet } from "@linky-fit/linkstr-react";
import React from "react";
import { useLatest } from "../../../hooks/useLatest";
import { localOverlayDismissStackAtom } from "../../state/shell/overlays";

/** Registers an open route-local sheet or modal so Android Back dismisses it before the route behind it. */
export const useRegisterTopModalDismiss = (
  open: boolean,
  dismiss: () => void,
): void => {
  const setStack = useAtomSet(localOverlayDismissStackAtom);
  const dismissRef = useLatest(dismiss);

  React.useEffect(() => {
    if (!open) return;
    const id = Symbol("localOverlayDismiss");
    const entry = { id, dismiss: () => dismissRef.current() };
    setStack((current) => [...current, entry]);
    return () => {
      setStack((current) => current.filter((item) => item.id !== id));
    };
  }, [dismissRef, open, setStack]);
};
