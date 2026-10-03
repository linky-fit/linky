import { Stack } from "@linky-fit/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// The demos are laid out at a real phone's CSS size, then scaled into the frame.
const screenWidth = 390;
const screenHeight = 844;

/** Renders an inert, phone-sized app screen scaled to fill its parent. */
export function ScaledScreen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setScale(entry.contentRect.width / screenWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      inert
      aria-hidden
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      <div
        style={{
          width: screenWidth,
          height: screenHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          display: "flex",
        }}
      >
        <Stack flex={1} gap="$none" backgroundColor="$background">
          {children}
        </Stack>
      </div>
    </div>
  );
}
