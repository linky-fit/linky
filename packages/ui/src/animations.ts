import { createAnimations } from "@tamagui/animations-react-native";
import { duration } from "./tokens";

export const animations = createAnimations({
  fast: { type: "timing", duration: duration.fast },
  base: { type: "timing", duration: duration.base },
  slow: { type: "timing", duration: duration.slow },
  countdown: { type: "timing", duration: duration.countdown },
});

export type TransitionName = keyof (typeof animations)["animations"];
