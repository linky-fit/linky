import { useLatest } from "../../../hooks/useLatest";
import React from "react";
import { onBackPress } from "../../../platform/appEvents";

interface NativeBackTargets {
  closeScan: () => void;
  dismissTopModal: (() => void) | null;
  navigateBack: (() => void) | null;
  scanIsOpen: boolean;
}

/**
 * Single source of truth for what the Android back press does right now.
 *
 * The order mirrors how `AuthenticatedLayout` stacks its surfaces: state-driven
 * modals render last and sit on top of the scan overlay, and only when nothing
 * is layered over the page do we walk the route up one level. Returning `null` means there is nothing to handle, so
 * the press stays uncancelled and the shell closes the app.
 */
export const resolveNativeBackAction = ({
  closeScan,
  dismissTopModal,
  navigateBack,
  scanIsOpen,
}: NativeBackTargets): (() => void) | null => {
  if (dismissTopModal) return dismissTopModal;
  if (scanIsOpen) return closeScan;
  return navigateBack;
};

/**
 * Routes the Android hardware/gesture back button into in-app navigation.
 *
 * The system runs its default action, closing the app, unless a handler
 * claims the press. We claim it whenever something is layered over the
 * page to dismiss or there is a parent route to walk up to, and otherwise leave
 * it alone so back exits the app as it does in any other Android app.
 *
 * The walk deliberately does not use `history.back()`. `navigateTo()` pushes a
 * new hash entry for every navigation, including the top-left back button, so
 * history only ever grows: stepping back through it bounces between the pages
 * the user visited instead of moving up the hierarchy, and on a cold start from
 * a deep link or notification there is no in-app entry to return to at all.
 */
export const useNativeBackHandler = (targets: NativeBackTargets) =>
  useBackAction(resolveNativeBackAction(targets));

/**
 * Hands each system back press to `action`; null leaves the press to the
 * system, which closes the app.
 */
export const useBackAction = (action: (() => void) | null) => {
  // Keep the newest action in a ref so the listener registers only once and
  // never runs against a stale route or a dismissed overlay.
  const actionRef = useLatest(action);

  React.useEffect(
    () =>
      onBackPress(() => {
        const current = actionRef.current;
        if (!current) return false;
        current();
        return true;
      }),
    [actionRef],
  );
};
