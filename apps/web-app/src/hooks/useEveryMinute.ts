import React from "react";
import { nowSeconds } from "../utils/time";

const subscribeEveryMinute = (onTick: () => void): (() => void) => {
  const interval = window.setInterval(onTick, 60_000);
  return () => window.clearInterval(interval);
};

/** `select(nowSec)`, re-evaluated every minute; a primitive result skips unchanged renders. */
export const useEveryMinute = <T extends string | null | undefined>(
  select: (nowSec: number) => T,
): T =>
  React.useSyncExternalStore(subscribeEveryMinute, () => select(nowSeconds()));
