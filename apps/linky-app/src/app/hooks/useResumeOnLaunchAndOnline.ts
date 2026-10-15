import React from "react";

/**
 * Runs `resume` once per function identity (a new instance arrives with each
 * composed runtime) and again whenever the browser comes back online, because
 * work interrupted while offline waits for the next resume pass.
 */
export const useResumeOnLaunchAndOnline = (
  resume: (() => void) | null,
): void => {
  const resumedForRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    if (resume === null) return;
    if (resumedForRef.current !== resume) {
      resumedForRef.current = resume;
      resume();
    }
    window.addEventListener("online", resume);
    return () => {
      window.removeEventListener("online", resume);
    };
  }, [resume]);
};
