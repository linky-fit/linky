import React from "react";
import type { UseGuideHighlightParams } from "../app/lib/guideTargets";

export type { UseGuideHighlightParams } from "../app/lib/guideTargets";

const PAD = 8;

/** Scrolls the walkthrough's target into view and reports where it is in the window. */
export const useGuideHighlight = ({
  target,
  stepId,
  routeKind,
  onRect,
}: UseGuideHighlightParams): void => {
  const selector =
    target === null
      ? null
      : `[data-guide="${target}"], [data-testid="${target}"]`;

  React.useEffect(() => {
    if (!selector) {
      onRect(null);
      return;
    }

    const el = document.querySelector(selector);
    if (!(el instanceof HTMLElement)) return;
    try {
      el.scrollIntoView({ block: "center", inline: "center" });
    } catch {
      // ignore
    }
  }, [selector, stepId, onRect]);

  React.useEffect(() => {
    if (!selector) return;

    let animationFrameId: number | null = null;
    const updateRect = () => {
      animationFrameId = null;
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement)) {
        onRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      onRect({
        top: Math.max(r.top - PAD, 8),
        left: Math.max(r.left - PAD, 8),
        width: Math.min(r.width + PAD * 2, window.innerWidth - 16),
        height: Math.min(r.height + PAD * 2, window.innerHeight - 16),
      });
    };
    const scheduleUpdateRect = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(updateRect);
    };

    scheduleUpdateRect();

    window.addEventListener("resize", scheduleUpdateRect);
    window.addEventListener("scroll", scheduleUpdateRect, { passive: true });
    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", scheduleUpdateRect);
      window.removeEventListener("scroll", scheduleUpdateRect);
    };
  }, [selector, routeKind, onRect]);
};
