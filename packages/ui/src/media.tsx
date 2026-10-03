import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { View as NativeView, PanResponder, StyleSheet } from "react-native";
import type {
  GestureResponderEvent,
  PanResponderGestureState,
} from "react-native";
import { Image, ScrollView, View } from "tamagui";
import type { GetProps } from "tamagui";
import { Stack } from "./layout";
import { border, radius, shadow, size, space } from "./tokens";

export interface MediaFrameProps {
  accessibilityLabel: string;
  aspectRatio?: number | undefined;
  /** Takes the free height of its column instead of keeping `aspectRatio`, e.g. a full-screen camera. */
  fill?: boolean | undefined;
  children: ReactNode;
}

/** A rounded, clipped frame for camera previews and images. */
export function MediaFrame({
  accessibilityLabel,
  aspectRatio = 1,
  fill = false,
  children,
}: MediaFrameProps) {
  return (
    <Stack
      aria-label={accessibilityLabel}
      position="relative"
      width="100%"
      maxWidth="$sheetWidth"
      {...(fill ? { flex: 1, minHeight: 0 } : { aspectRatio })}
      alignSelf="center"
      overflow="hidden"
      borderRadius="$card"
      backgroundColor="$neutralSoft"
    >
      {children}
    </Stack>
  );
}

export type DeviceFrameProps = GetProps<typeof Stack> & {
  /** The screen, e.g. a screenshot that fills the frame. */
  children: ReactNode;
};

/** A phone around a screen, for showing the app in context; `$device` wide unless sized. */
export function DeviceFrame({ children, ...props }: DeviceFrameProps) {
  return (
    <Stack
      width="$device"
      padding="$sm"
      borderRadius="$device"
      backgroundColor="$bezel"
      borderWidth={border.hairline}
      borderColor="$borderColorHover"
      boxShadow={shadow.floating}
      {...props}
    >
      <Stack
        position="relative"
        aspectRatio={390 / 844}
        overflow="hidden"
        borderRadius={radius.device - space.sm}
        backgroundColor="$background"
      >
        {children}
      </Stack>
    </Stack>
  );
}

export interface ImageCropCenter {
  x: number;
  y: number;
}

export interface ImageCropPreviewProps {
  uri: string;
  accessibilityLabel: string;
  imageWidth: number;
  imageHeight: number;
  center: ImageCropCenter;
  zoom: number;
  onCenterChange: (center: ImageCropCenter) => void;
  disabled?: boolean | undefined;
}

/** A circular avatar crop: drag the image to move the center, zoom from outside. */
export function ImageCropPreview({
  uri,
  accessibilityLabel,
  imageWidth,
  imageHeight,
  center,
  zoom,
  onCenterChange,
  disabled,
}: ImageCropPreviewProps) {
  const [viewport, setViewport] = useState(size.qr);
  const dragStart = useRef(center);
  const latest = useRef(center);
  useLayoutEffect(() => {
    latest.current = center;
  }, [center]);
  const scale = Math.max(viewport / imageWidth, viewport / imageHeight) * zoom;
  const beginDrag = useCallback(() => {
    dragStart.current = latest.current;
  }, []);
  const moveDrag = useCallback(
    (_event: GestureResponderEvent, gesture: PanResponderGestureState) => {
      const half = Math.min(imageWidth, imageHeight) / zoom / 2;
      const clamp = (value: number, extent: number) =>
        Math.min(extent - half, Math.max(half, value));
      onCenterChange({
        x: clamp(dragStart.current.x - gesture.dx / scale, imageWidth),
        y: clamp(dragStart.current.y - gesture.dy / scale, imageHeight),
      });
    },
    [imageWidth, imageHeight, onCenterChange, scale, zoom],
  );
  const responder = useMemo(
    () =>
      // PanResponder stores these callbacks; it does not call them during render.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: beginDrag,
        onPanResponderMove: moveDrag,
      }),
    [beginDrag, disabled, moveDrag],
  );
  return (
    <View
      aria-label={accessibilityLabel}
      position="relative"
      width="100%"
      maxWidth="$qr"
      aspectRatio={1}
      alignSelf="center"
      overflow="hidden"
      borderRadius="$card"
      backgroundColor="$neutralSoft"
      onLayout={(event) => setViewport(event.nativeEvent.layout.width)}
    >
      <Image
        src={uri}
        pointerEvents="none"
        position="absolute"
        width={imageWidth * scale}
        height={imageHeight * scale}
        left={viewport / 2 - center.x * scale}
        top={viewport / 2 - center.y * scale}
        aria-hidden
      />
      <View
        position="absolute"
        inset={0}
        borderRadius="$pill"
        borderWidth={border.emphasis}
        borderColor="$accent"
        pointerEvents="none"
      />
      {/* Tamagui views ignore responder props on the web; React Native views take them everywhere. */}
      <NativeView {...responder.panHandlers} style={StyleSheet.absoluteFill} />
    </View>
  );
}

export interface DocumentPage {
  uri: string;
  accessibilityLabel: string;
  width: number;
  height: number;
}

export function DocumentPages({ pages }: { pages: readonly DocumentPage[] }) {
  return (
    <ScrollView
      width="100%"
      maxWidth="$contentWidth"
      alignSelf="center"
      contentContainerStyle={{
        gap: space.md,
        flexGrow: 1,
        justifyContent: "center",
      }}
    >
      {pages.map((page) => (
        <Image
          key={page.uri}
          src={page.uri}
          aria-label={page.accessibilityLabel}
          width="100%"
          aspectRatio={page.width / page.height}
          objectFit="contain"
          borderRadius="$sm"
        />
      ))}
    </ScrollView>
  );
}
