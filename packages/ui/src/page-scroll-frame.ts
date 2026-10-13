import { createContext, type RefObject } from "react";
import type { Animated, View } from "react-native";

/** The enclosing native PageScroll, against which boxes the web pins to the page frame are placed. */
export interface PageScrollFrame {
  readonly scrollY: Animated.Value;
  /** The visible height of the scroller. */
  readonly height: number;
  /** The scrolled content, the origin boxes measure their place from. */
  readonly content: RefObject<View | null>;
}

export const PageScrollFrameContext = createContext<PageScrollFrame | null>(
  null,
);
