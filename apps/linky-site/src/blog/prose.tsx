import { DeviceFrame, Image, Stack, Text } from "@linky-fit/ui";
import type { ReactNode } from "react";
import type { Screen } from "../landing/copy";
import { Phone } from "../landing/parts";

export function Paragraph({ children }: { children: ReactNode }) {
  return <Text variant="body">{children}</Text>;
}

export function Heading({ children }: { children: string }) {
  return (
    <Text
      variant="heading"
      color="$colorStrong"
      role="heading"
      aria-level={2}
      paddingTop="$lg"
    >
      {children}
    </Text>
  );
}

interface FigureProps {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export function Figure({ src, alt, width, height }: FigureProps) {
  return (
    <Image
      src={src}
      alt={alt}
      width="100%"
      maxWidth="$sheetWidth"
      aspectRatio={width / height}
      alignSelf="center"
      borderRadius="$card"
    />
  );
}

/** A live app demo from the landing page in a phone, replaying whenever it scrolls into view. */
export function DemoFigure({
  screen,
  caption,
}: {
  screen: Screen;
  caption: string;
}) {
  return (
    <Stack
      render={<figure />}
      alignItems="center"
      gap="$lg"
      paddingVertical="$lg"
      margin="$none"
    >
      <Phone screen={screen} width="$qr" />
      <Text
        render={<figcaption />}
        variant="caption"
        color="$colorMuted"
        textAlign="center"
      >
        {caption}
      </Text>
    </Stack>
  );
}

export function Subheading({ children }: { children: string }) {
  return (
    <Text
      variant="title"
      color="$colorStrong"
      role="heading"
      aria-level={3}
      paddingTop="$sm"
    >
      {children}
    </Text>
  );
}

export interface AppScreenshot {
  src: string;
  width: number;
  height: number;
}

/** A screenshot of the app in a phone, with a caption, like `DemoFigure` without the animation. */
export function ScreenshotFigure({
  shot,
  alt,
  caption,
}: {
  shot: AppScreenshot;
  alt: string;
  caption: string;
}) {
  return (
    <Stack
      render={<figure />}
      alignItems="center"
      gap="$lg"
      paddingVertical="$lg"
      margin="$none"
    >
      <DeviceFrame width="$qr">
        <Image
          src={shot.src}
          alt={alt}
          width="100%"
          height="100%"
          objectFit="cover"
          objectPosition="top"
        />
      </DeviceFrame>
      <Text
        render={<figcaption />}
        variant="caption"
        color="$colorMuted"
        textAlign="center"
      >
        {caption}
      </Text>
    </Stack>
  );
}
