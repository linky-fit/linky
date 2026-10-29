import type { Pubkey } from "@linky-fit/linkstr";
import { useSyncExternalStore } from "react";

/** A payment that just arrived, as the banner over whatever screen is open shows it. */
export interface PaidBanner {
  /** The payment's id, so the same arrival is announced once. */
  readonly key: string;
  readonly title: string;
  readonly amount: string;
  readonly unit: string;
  readonly payerPubkey: Pubkey | null;
}

/** How long the banner stays before it closes itself. */
export const PAID_BANNER_MS = 3_000;

let current: PaidBanner | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const set = (next: PaidBanner | null) => {
  current = next;
  for (const listener of listeners) listener();
};

const clearTimer = () => {
  if (timer !== null) clearTimeout(timer);
  timer = null;
};

/** Shows `banner` for `PAID_BANNER_MS`, replacing one still on screen. */
export const showPaidBanner = (banner: PaidBanner): void => {
  clearTimer();
  set(banner);
  timer = setTimeout(() => {
    timer = null;
    set(null);
  }, PAID_BANNER_MS);
};

export const dismissPaidBanner = (): void => {
  clearTimer();
  set(null);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The banner on screen, or null. */
export const readPaidBanner = (): PaidBanner | null => current;

export const usePaidBanner = (): PaidBanner | null =>
  useSyncExternalStore(subscribe, readPaidBanner);
