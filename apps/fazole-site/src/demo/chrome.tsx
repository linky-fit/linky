import {
  DeviceFrame,
  IconButton,
  Pressable,
  Row,
  Screen,
  ScrollView,
  shadow,
  space,
  Stack,
  Text,
  TopBar,
} from "@linky-fit/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { copy } from "../copy";

// Screens are laid out at a real phone's CSS size, then scaled to the frame.
const screen = { width: 390, height: 844 };

function StatusBar() {
  return (
    <Row
      height="$control"
      flexShrink={0}
      justifyContent="space-between"
      paddingHorizontal="$xxxl"
      backgroundColor="$background"
    >
      <Text variant="label" bold color="$colorStrong">
        9:41
      </Text>
      <Row gap="$xs" alignItems="flex-end">
        {[5, 7, 9, 11].map((height) => (
          <Stack
            key={height}
            width={3}
            height={height}
            borderRadius={1}
            backgroundColor="$colorStrong"
          />
        ))}
        <Stack
          width={22}
          height={11}
          marginLeft="$xs"
          borderRadius={3}
          backgroundColor="$colorStrong"
        />
      </Row>
    </Row>
  );
}

function HomeIndicator() {
  return (
    <Row
      position="absolute"
      left={0}
      right={0}
      bottom="$sm"
      justifyContent="center"
      pointerEvents="none"
    >
      <Stack
        width="35%"
        height={5}
        borderRadius="$pill"
        backgroundColor="$colorStrong"
      />
    </Row>
  );
}

/** A phone around a live, phone-sized app screen, scaled to the frame's width. */
export function PhoneFrame({
  accessibilityLabel,
  maxWidth,
  children,
}: {
  /** Names the phone for assistive technology, e.g. "Živé demo terminálu". */
  accessibilityLabel: string;
  /** The frame's widest size; it shrinks with its column. */
  maxWidth: number;
  children: ReactNode;
}) {
  const [scale, setScale] = useState(0);
  return (
    <DeviceFrame
      role="group"
      aria-label={accessibilityLabel}
      width="100%"
      maxWidth={maxWidth}
      alignSelf="center"
      borderWidth={0}
    >
      <Stack
        position="absolute"
        inset={0}
        onLayout={(event) =>
          setScale(event.nativeEvent.layout.width / screen.width)
        }
      >
        <Stack
          position="absolute"
          top={0}
          left={0}
          width={screen.width}
          height={screen.height}
          scale={scale}
          transformOrigin="left top"
          gap="$none"
          backgroundColor="$background"
        >
          <StatusBar />
          <Stack flex={1} gap="$none" minHeight={0} position="relative">
            {children}
          </Stack>
          <HomeIndicator />
        </Stack>
      </Stack>
    </DeviceFrame>
  );
}

/** A mock screen with room for an overlay over its tab bar too, like the app's portaled sheets. */
export function DemoScreen({
  tabBar,
  overlay,
  children,
}: {
  tabBar?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Stack flex={1} gap="$none" minHeight={0} position="relative">
      <Stack flex={1} gap="$none" minHeight={0} overflow="hidden">
        {children}
      </Stack>
      {tabBar}
      {overlay}
    </Stack>
  );
}

/** A scrolling page in the phone, like the app's `Page`; `title` names it in a top bar. */
export function Page({
  title,
  centered = false,
  children,
}: {
  title?: string | undefined;
  centered?: boolean | undefined;
  children: ReactNode;
}) {
  const page = (
    <ScrollView flex={1} contentContainerStyle={{ flexGrow: 1 }}>
      <Screen justifyContent={centered ? "center" : "flex-start"} gap="$xl">
        {children}
      </Screen>
    </ScrollView>
  );
  if (!title) return page;
  return (
    <Stack flex={1} gap="$none" minHeight={0}>
      <TopBar title={title} />
      {page}
    </Stack>
  );
}

const rise = { opacity: 0, y: space.huge } as const;

/**
 * The app's `Sheet` (or, as a `dialog`, its `Dialog`) drawn inside the phone:
 * the real ones portal over the whole page.
 */
export function DemoSheet({
  open,
  onClose,
  title,
  dialog = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  dialog?: boolean | undefined;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <Stack
      position="absolute"
      inset={0}
      zIndex="$overlay"
      gap="$none"
      justifyContent={dialog ? "center" : "flex-end"}
      padding={dialog ? "$xl" : "$none"}
      paddingTop="$huge"
    >
      <Pressable
        position="absolute"
        inset={0}
        cursor="default"
        backgroundColor="$scrim"
        aria-hidden
        tabIndex={-1}
        onPress={onClose}
        transition="fast"
        enterStyle={{ opacity: 0 }}
      />
      <Stack
        role="dialog"
        aria-label={title}
        position="relative"
        maxHeight="100%"
        backgroundColor="$surface"
        boxShadow={shadow.floating}
        transition="base"
        enterStyle={rise}
        gap="$sm"
        {...(dialog
          ? { padding: "$xl", borderRadius: "$card" }
          : {
              paddingHorizontal: "$xl",
              paddingTop: "$md",
              paddingBottom: "$xxl",
              borderTopLeftRadius: "$sheet",
              borderTopRightRadius: "$sheet",
            })}
      >
        <Row justifyContent="space-between">
          <Text
            flex={1}
            variant={dialog ? "title" : "label"}
            color={dialog ? "$color" : "$colorMuted"}
            paddingVertical="$xs"
          >
            {title}
          </Text>
          {dialog ? (
            <IconButton
              icon="X"
              size="sm"
              accessibilityLabel={copy.demo.close}
              onPress={onClose}
            />
          ) : null}
        </Row>
        <ScrollView flexShrink={1}>
          <Stack>{children}</Stack>
        </ScrollView>
      </Stack>
    </Stack>
  );
}

export interface Detail {
  readonly label: string;
  readonly value: string;
}

/** Label and value pairs, like the app's `DetailRows`. */
export function DetailRows({ details }: { details: readonly Detail[] }) {
  return (
    <Stack gap="$sm">
      {details.map(({ label, value }) => (
        <Row key={label} justifyContent="space-between" alignItems="flex-start">
          <Text variant="label" fontWeight="$regular" color="$colorMuted">
            {label}
          </Text>
          <Text
            variant="label"
            flexShrink={1}
            textAlign="right"
            fontVariant={["tabular-nums"]}
          >
            {value}
          </Text>
        </Row>
      ))}
    </Stack>
  );
}
