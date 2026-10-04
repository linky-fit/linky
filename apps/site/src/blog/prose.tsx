import { Image, Text } from "@linky-fit/ui";
import type { ReactNode } from "react";

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
