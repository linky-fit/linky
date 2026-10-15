import React from "react";
import { useOnline } from "./useOnline";

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

interface IdleRequestOptionsLike {
  timeout?: number;
}

type RequestIdleCallbackLike = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: IdleRequestOptionsLike,
) => number;

type CancelIdleCallbackLike = (handle: number) => void;

interface UseDeferredOnlineReadyOptions {
  delayMs?: number;
  idleTimeoutMs?: number;
}

const getRequestIdleCallback = (): RequestIdleCallbackLike | null => {
  const candidate = Reflect.get(window, "requestIdleCallback");
  if (typeof candidate !== "function") return null;

  return (callback, options) => {
    const result = Reflect.apply(candidate, window, [callback, options]);
    return typeof result === "number" ? result : 0;
  };
};

const getCancelIdleCallback = (): CancelIdleCallbackLike | null => {
  const candidate = Reflect.get(window, "cancelIdleCallback");
  if (typeof candidate !== "function") return null;

  return (handle) => {
    void Reflect.apply(candidate, window, [handle]);
  };
};

export const useDeferredOnlineReady = (
  options?: UseDeferredOnlineReadyOptions,
): boolean => {
  const delayMs = options?.delayMs ?? 150;
  const idleTimeoutMs = options?.idleTimeoutMs ?? 1500;

  const [hasDeferredStartup, setHasDeferredStartup] = React.useState(false);
  const isOnline = useOnline();

  React.useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const markReady = () => {
      if (cancelled) return;
      setHasDeferredStartup(true);
    };

    const scheduleIdle = () => {
      const requestIdleCallback = getRequestIdleCallback();
      if (requestIdleCallback) {
        idleId = requestIdleCallback(
          () => {
            markReady();
          },
          { timeout: idleTimeoutMs },
        );
        return;
      }

      markReady();
    };

    timeoutId = window.setTimeout(scheduleIdle, delayMs);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      const cancelIdleCallback = getCancelIdleCallback();
      if (idleId !== null && cancelIdleCallback) {
        cancelIdleCallback(idleId);
      }
    };
  }, [delayMs, idleTimeoutMs]);

  return hasDeferredStartup && isOnline;
};
