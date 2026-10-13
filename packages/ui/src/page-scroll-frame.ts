import { createContext, use, type RefObject } from "react";
import type { Animated, ScrollView as ScrollViewRef, View } from "react-native";

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

interface MountedPageScroll {
  readonly scroll: RefObject<ScrollViewRef | null>;
  readonly content: RefObject<View | null>;
  readonly height: RefObject<number>;
}

const mountedPageScrolls = new Set<MountedPageScroll>();

/** Lets `revealInPageScroll` find a native PageScroll; returns the unregister function. */
export const registerPageScroll = (mounted: MountedPageScroll) => {
  mountedPageScrolls.add(mounted);
  return () => {
    mountedPageScrolls.delete(mounted);
  };
};

type Measurable = Pick<View, "measureLayout">;

const isMeasurable = (node: object): node is Measurable =>
  "measureLayout" in node && typeof node.measureLayout === "function";

const offsetIn = (node: Measurable, content: View): Promise<number | null> =>
  new Promise((resolve) =>
    node.measureLayout(
      content,
      (_left, top, _width, nodeHeight) => resolve(top + nodeHeight / 2),
      () => resolve(null),
    ),
  );

const heightOf = (view: View): Promise<number> =>
  new Promise((resolve) =>
    view.measure((_x, _y, _width, height) => resolve(height)),
  );

/** Scrolls the native PageScroll holding `node` so the node sits in its middle; resolves whether one holds it. The web has none: elements scroll themselves. */
export async function revealInPageScroll(node: object): Promise<boolean> {
  if (!isMeasurable(node)) return false;
  for (const { scroll, content, height } of mountedPageScrolls) {
    if (!content.current) continue;
    const middle = await offsetIn(node, content.current);
    if (middle === null) continue;
    const contentHeight = await heightOf(content.current);
    const y = Math.min(
      Math.max(middle - height.current / 2, 0),
      Math.max(contentHeight - height.current, 0),
    );
    scroll.current?.scrollTo({ y, animated: true });
    return true;
  }
  return false;
}

/** The visible height of the enclosing PageScroll, for content that must fit it, e.g. a nested scroller; null until known and on the web, where CSS sizes it. */
export function usePageScrollHeight(): number | null {
  const height = use(PageScrollFrameContext)?.height ?? 0;
  return height > 0 ? height : null;
}
