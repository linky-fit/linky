import React from "react";

/**
 * Runs at most one task at a time; calls made while a task is running are
 * dropped. The ref flips synchronously, so it also stops a second call made
 * before React re-renders with a busy state.
 */
export const useExclusiveRun = () => {
  const isRunningRef = React.useRef(false);
  return React.useCallback(async (task: () => Promise<void>): Promise<void> => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    try {
      await task();
    } finally {
      isRunningRef.current = false;
    }
  }, []);
};
