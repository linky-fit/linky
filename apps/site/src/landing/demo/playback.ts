import { useEffect, useState } from "react";

const reducedMotion = window.matchMedia(
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

/** The entrance class of an element that appears at a cue. */
export const enter = (shown: boolean, animation = "demo-in") =>
  shown ? animation : "demo-hidden";

/** Eases a number from `from` to `to`, starting `delay` ms after the demo mounts. */
export function useCountUp(
  from: number,
  to: number,
  delay: number,
  duration: number,
) {
  const [value, setValue] = useState(reducedMotion ? to : from);
  useEffect(() => {
    if (reducedMotion) return;
    const start = performance.now() + delay;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / duration));
      setValue(from + (to - from) * (1 - (1 - progress) ** 3));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to, delay, duration]);
  return value;
}
