import React from "react";
import { useOnline } from "./useOnline";

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

interface IdleRequestOptionsLike {
  timeout?: number;
}

// React Native's handle is an object, the browser's a number.
type IdleHandle = unknown;

type RequestIdleCallbackLike = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: IdleRequestOptionsLike,
) => IdleHandle;

type CancelIdleCallbackLike = (handle: IdleHandle) => void;

interface UseDeferredOnlineReadyOptions {
  delayMs?: number;
  idleTimeoutMs?: number;
}

const getRequestIdleCallback = (): RequestIdleCallbackLike | null => {
  const candidate = Reflect.get(globalThis, "requestIdleCallback");
  if (typeof candidate !== "function") return null;

  return (callback, options): IdleHandle =>
    Reflect.apply(candidate, globalThis, [callback, options]);
};

const getCancelIdleCallback = (): CancelIdleCallbackLike | null => {
  const candidate = Reflect.get(globalThis, "cancelIdleCallback");
  if (typeof candidate !== "function") return null;

  return (handle) => {
    void Reflect.apply(candidate, globalThis, [handle]);
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
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: IdleHandle = null;

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

    timeoutId = setTimeout(scheduleIdle, delayMs);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      const cancelIdleCallback = getCancelIdleCallback();
      if (idleId !== null && cancelIdleCallback) {
        cancelIdleCallback(idleId);
      }
    };
  }, [delayMs, idleTimeoutMs]);

  return hasDeferredStartup && isOnline;
};
