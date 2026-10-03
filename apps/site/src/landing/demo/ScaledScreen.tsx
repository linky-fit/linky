import { Row, Stack, Text } from "@linky-fit/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import "./demo.css";

// The demos are laid out at a real phone's CSS size, then scaled into the frame.
const screenWidth = 390;
const screenHeight = 844;

function SignalBars() {
  return (
    <Row alignItems="flex-end" gap="$xxs">
      {[4, 6, 8.5, 11].map((height) => (
        <Stack
          key={height}
          width={3}
          height={height}
          borderRadius={1}
          backgroundColor="$color"
        />
      ))}
    </Row>
  );
}

// Each band is the top quarter of a ring around a point at the glyph's foot.
function WifiGlyph() {
  return (
    <Stack width={16} height={12} position="relative" overflow="hidden">
      {[11, 7].map((radius) => (
        <Stack
          key={radius}
          position="absolute"
          left={8 - radius}
          top={12 - radius}
          width={radius * 2}
          height={radius * 2}
          borderRadius="$pill"
          borderWidth={2.2}
          borderColor="$transparent"
          borderTopColor="$color"
        />
      ))}
      <Stack
        position="absolute"
        left={5.5}
        top={7.5}
        width={5}
        height={5}
        borderRadius="$pill"
        backgroundColor="$color"
      />
    </Stack>
  );
}

function BatteryGlyph() {
  return (
    <Row alignItems="center" gap={1}>
      <Stack
        width={25}
        height={12}
        padding={2}
        borderRadius={4}
        borderWidth={1}
        borderColor="$colorMuted"
      >
        <Stack flex={1} borderRadius={2} backgroundColor="$color" />
      </Stack>
      <Stack
        width={1.5}
        height={4}
        borderRadius={1}
        backgroundColor="$colorMuted"
      />
    </Row>
  );
}

/** The phone's status bar around the dynamic island, as the screen's top safe area. */
function StatusBar() {
  return (
    <Row
      position="absolute"
      top="$none"
      left="$none"
      right="$none"
      height="$huge"
      gap="$none"
    >
      <Stack flex={1} alignItems="center">
        <Text variant="title" fontWeight="$semibold" color="$color">
          9:41
        </Text>
      </Stack>
      <Stack
        width="$hero"
        height="$controlSm"
        borderRadius="$pill"
        backgroundColor="$bezel"
      />
      <Row flex={1} justifyContent="center" gap="$xs">
        <SignalBars />
        <WifiGlyph />
        <BatteryGlyph />
      </Row>
    </Row>
  );
}

function HomeIndicator() {
  return (
    <Stack
      position="absolute"
      left="$none"
      right="$none"
      bottom="$sm"
      alignItems="center"
    >
      <Stack
        width={134}
        height={5}
        borderRadius="$pill"
        backgroundColor="$colorStrong"
      />
    </Stack>
  );
}

/** Renders inert, phone-sized app screens under a status bar, scaled to fill their parent. */
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
          position: "relative",
          width: screenWidth,
          height: screenHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
        <StatusBar />
        <HomeIndicator />
      </div>
    </div>
  );
}
