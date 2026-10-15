import { navigateTo } from "../../hooks/useRouting";

/**
 * A scanned join URL waits here for the Add company page instead of in the
 * route hash, which browser history would keep: its private feed URLs are secrets.
 */
let pending: string | null = null;
const listeners = new Set<() => void>();

/** Join URLs live on the company's join path; any other URL is left to other scanners. */
export const isKeryxJoinUrl = (text: string): boolean => {
  try {
    const url = new URL(text.trim());
    return (
      url.protocol === "https:" &&
      (url.pathname === "/join" || url.pathname === "/join/")
    );
  } catch {
    return false;
  }
};

export const offerKeryxJoin = (text: string): void => {
  pending = text.trim();
  for (const listener of listeners) listener();
  navigateTo({ route: "keryxCompanyNew" });
};

export const subscribeKeryxJoinOffer = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const peekKeryxJoinOffer = (): string | null => pending;

export const takeKeryxJoinOffer = (): string | null => {
  const offer = pending;
  pending = null;
  return offer;
};
