import React from "react";

const ARMED_MS = 5_000;

/**
 * Two-tap confirmation for destructive actions: the first `confirm` arms it
 * for a few seconds and calls `onArm` (typically a hint toast), the second
 * runs the action.
 */
export const useArmedAction = (onArm?: () => void) => {
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!armed) return;
    const timeoutId = window.setTimeout(() => setArmed(false), ARMED_MS);
    return () => window.clearTimeout(timeoutId);
  }, [armed]);

  const confirm = (action: () => void) => {
    if (!armed) {
      setArmed(true);
      onArm?.();
      return;
    }
    setArmed(false);
    action();
  };

  return { armed, confirm };
};
