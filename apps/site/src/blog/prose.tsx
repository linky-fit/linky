import { Image, Stack, Text } from "@linky-fit/ui";
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
