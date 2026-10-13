import { createContext, use, type RefObject } from "react";
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

/** The visible height of the enclosing PageScroll, for content that must fit it, e.g. a nested scroller; null until known and on the web, where CSS sizes it. */
export function usePageScrollHeight(): number | null {
  const height = use(PageScrollFrameContext)?.height ?? 0;
  return height > 0 ? height : null;
}
