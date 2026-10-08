import { DeviceFrame, Icon, Row, Stack, Text } from "@linky-fit/ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Screens are laid out at a real phone's CSS size, then scaled into the frame.
const screenWidth = 390;
const screenHeight = 844;
export const statusBarHeight = 40;

function SignalBars() {
  return (
    <Row alignItems="flex-end" gap={1}>
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

function BatteryGlyph() {
  return (
    <Stack
      width={11}
      height={18}
      padding={1.5}
      borderRadius={3}
      borderWidth={1.5}
      borderColor="$color"
      justifyContent="flex-end"
    >
      <Stack height={11} borderRadius={1} backgroundColor="$color" />
    </Stack>
  );
}

/** Android's status bar: time and notification icons left, punch-hole camera, system icons right. */
function StatusBar({ beaconOn }: { beaconOn: boolean }) {
  return (
    <Row
      position="absolute"
      top="$none"
      left="$none"
      right="$none"
      height={statusBarHeight}
      paddingHorizontal="$xxl"
      justifyContent="space-between"
    >
      <Row gap="$sm">
        <Text variant="label" color="$color">
          9:41
        </Text>
        {beaconOn ? <Icon name="Radio" size="sm" color="$color" /> : null}
      </Row>
      <Stack
        position="absolute"
        left={screenWidth / 2 - 7}
        top={13}
        width={14}
        height={14}
        borderRadius="$pill"
        backgroundColor="$bezel"
      />
      <Row gap="$sm">
        <SignalBars />
        <BatteryGlyph />
      </Row>
    </Row>
  );
}

function GestureBar() {
  return (
    <Stack
      position="absolute"
      left="$none"
      right="$none"
      bottom="$sm"
      alignItems="center"
    >
      <Stack
        width={110}
        height={4}
        borderRadius="$pill"
        backgroundColor="$colorStrong"
      />
    </Stack>
  );
}

/** Renders an inert, phone-sized screen under the status bar, scaled to fill its parent. */
function ScaledScreen({
  beaconOn,
  children,
}: {
  beaconOn: boolean;
  children: ReactNode;
}) {
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
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Stack
          flex={1}
          paddingTop={statusBarHeight}
          backgroundColor="$background"
        >
          {children}
        </Stack>
        <StatusBar beaconOn={beaconOn} />
        <GestureBar />
      </div>
    </div>
  );
}

/** One app screen in a phone frame, with a caption below. */
export function Phone({
  caption,
  beaconOn = false,
  width = 280,
  children,
}: {
  caption?: string;
  beaconOn?: boolean;
  width?: number;
  children: ReactNode;
}) {
  return (
    <Stack gap="$md" alignItems="center" width={width}>
      <DeviceFrame width={width}>
        <ScaledScreen beaconOn={beaconOn}>{children}</ScaledScreen>
      </DeviceFrame>
      {caption ? (
        <Text variant="label" color="$colorMuted" textAlign="center">
          {caption}
        </Text>
      ) : null}
    </Stack>
  );
}
