import { revealInPageScroll } from "@linky-fit/ui";
import React from "react";
import { Dimensions } from "react-native";
import {
  guideTargetNodes,
  type GuideTargetNode,
  type UseGuideHighlightParams,
} from "../app/lib/guideTargets";
import type { GuideHighlightRect } from "../app/state/shell/guide";
export type { UseGuideHighlightParams } from "../app/lib/guideTargets";

const PAD = 8;
// Native has no scroll or resize events for the whole screen, so the target is re-measured.
const MEASURE_EVERY_MS = 250;
const REVEAL_ATTEMPTS = 8;

interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// A view that unmounted never answers, so its measurement gives up after one interval.
const measureInWindow = (node: GuideTargetNode): Promise<WindowRect | null> =>
  new Promise((resolve) => {
    if (
      !("measureInWindow" in node) ||
      typeof node.measureInWindow !== "function"
    ) {
      resolve(null);
      return;
    }
    setTimeout(() => resolve(null), MEASURE_EVERY_MS);
    node.measureInWindow(
      (x: number, y: number, width: number, height: number) =>
        resolve({ x, y, width, height }),
    );
  });

/** The topmost of the target's elements that is on screen, as a padded highlight. */
const measureTarget = async (
  target: string,
): Promise<GuideHighlightRect | null> => {
  const window = Dimensions.get("window");
  const rects = await Promise.all(
    guideTargetNodes(target).map(measureInWindow),
  );
  const visible = rects
    .filter(
      (rect): rect is WindowRect =>
        rect !== null &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.y + rect.height > 0 &&
        rect.y < window.height,
    )
    .sort((a, b) => a.y - b.y)[0];
  if (!visible) return null;
  return {
    top: Math.max(visible.y - PAD, 8),
    left: Math.max(visible.x - PAD, 8),
    width: Math.min(visible.width + PAD * 2, window.width - 16),
    height: Math.min(visible.height + PAD * 2, window.height - 16),
  };
};

const sameRect = (
  a: GuideHighlightRect | null,
  b: GuideHighlightRect | null,
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height);

/** Scrolls the walkthrough's target into view and reports where it is in the window while the step shows. */
export const useGuideHighlight = ({
  target,
  stepId,
  routeKind,
  onRect,
}: UseGuideHighlightParams): void => {
  React.useEffect(() => {
    if (target === null) return;
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The target can mount after the step starts, e.g. on the page the step opens.
    const reveal = async () => {
      const [node] = guideTargetNodes(target);
      const revealed = node !== undefined && (await revealInPageScroll(node));
      attempts += 1;
      if (cancelled || revealed || attempts >= REVEAL_ATTEMPTS) return;
      timer = setTimeout(() => void reveal(), MEASURE_EVERY_MS);
    };
    void reveal();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [target, stepId]);

  React.useEffect(() => {
    if (target === null) {
      onRect(null);
      return;
    }
    let cancelled = false;
    let last: GuideHighlightRect | null | undefined;
    const update = () =>
      void measureTarget(target).then((rect) => {
        if (cancelled || (last !== undefined && sameRect(rect, last))) return;
        last = rect;
        onRect(rect);
      });
    update();
    const timer = setInterval(update, MEASURE_EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [target, routeKind, onRect]);
};
