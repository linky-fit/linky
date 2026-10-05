import { createAnimations } from "@tamagui/animations-css";
import { duration, easing } from "./tokens";

export const animations = createAnimations({
  fast: `${easing.standard} ${duration.fast}ms`,
  base: `${easing.standard} ${duration.base}ms`,
  slow: `${easing.overshoot} ${duration.slow}ms`,
  countdown: `linear ${duration.countdown}ms`,
});

export type TransitionName = keyof (typeof animations)["animations"];
