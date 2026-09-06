import { useLatest } from "../../../hooks/useLatest";
import React from "react";
import { NATIVE_BACK_BUTTON_EVENT } from "../../../hooks/useRouting";

interface NativeBackTargets {
  closeMenu: () => void;
  closeScan: () => void;
  dismissTopModal: (() => void) | null;
  menuIsOpen: boolean;
  navigateBack: (() => void) | null;
  scanIsOpen: boolean;
}

/**
 * Single source of truth for what the Android back press does right now.
 *
 * The order mirrors how `AuthenticatedLayout` stacks its surfaces: state-driven
 * modals render last and sit on top of the scan overlay, the scan overlay sits
 * on top of the menu, and only when nothing is layered over the page do we walk
 * the route up one level. Returning `null` means there is nothing to handle, so
 * the press stays uncancelled and the shell closes the app.
 */
export const resolveNativeBackAction = ({
  closeMenu,
  closeScan,
  dismissTopModal,
  menuIsOpen,
  navigateBack,
  scanIsOpen,
}: NativeBackTargets): (() => void) | null => {
  if (dismissTopModal) return dismissTopModal;
  if (scanIsOpen) return closeScan;
  if (menuIsOpen) return closeMenu;
  return navigateBack;
};

/**
 * Routes the Android hardware/gesture back button into in-app navigation.
 *
 * The shell dispatches a cancelable `linky-native-back-button` event and runs
 * its default action — closing the app — unless a listener calls
 * `preventDefault()`. We claim the press whenever something is layered over the
 * page to dismiss or there is a parent route to walk up to, and otherwise leave
 * it alone so back exits the app as it does in any other Android app.
 *
 * The walk deliberately does not use `history.back()`. `navigateTo()` pushes a
 * new hash entry for every navigation, including the top-left back button, so
 * history only ever grows: stepping back through it bounces between the pages
 * the user visited instead of moving up the hierarchy, and on a cold start from
 * a deep link or notification there is no in-app entry to return to at all.
 */
export const useNativeBackHandler = (targets: NativeBackTargets) => {
  const backAction = resolveNativeBackAction(targets);

  // Keep the newest action in a ref so the listener registers only once and
  // never runs against a stale route or a dismissed overlay.
  const backActionRef = useLatest(backAction);

  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const onNativeBack = (event: Event) => {
      const action = backActionRef.current;
      if (!action) return;

      event.preventDefault();
      action();
    };

    window.addEventListener(NATIVE_BACK_BUTTON_EVENT, onNativeBack);
    return () =>
      window.removeEventListener(NATIVE_BACK_BUTTON_EVENT, onNativeBack);
  }, [backActionRef]);
};
