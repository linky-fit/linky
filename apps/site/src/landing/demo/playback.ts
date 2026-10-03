import { useEffect, useMemo, useRef, useState } from "react";

export const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/** How many of the cues (ms after the demo mounts) have passed; all of them with reduced motion. */
export function useCues(cues: readonly number[]) {
  const [passed, setPassed] = useState(reducedMotion ? cues.length : 0);
  useEffect(() => {
    if (reducedMotion) return;
    const timers = cues.map((at, index) =>
      setTimeout(() => setPassed(index + 1), at),
    );
    return () => timers.forEach(clearTimeout);
  }, [cues]);
  return passed;
}

/** Whether at least half of the element is on screen. */
export function useInView() {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, inView };
}

/** Plays named cues (ms after mount, in time order) and tells whether one has passed. */
export function useFlow<Cue extends string>(cues: Record<Cue, number>) {
  const order = Object.keys(cues);
  const times = useMemo(() => Object.values<number>(cues), [cues]);
  const passed = useCues(times);
  return (cue: Cue) => passed > order.indexOf(cue);
}
