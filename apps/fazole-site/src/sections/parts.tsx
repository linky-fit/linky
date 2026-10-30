import { Card, Icon, Image, Row, Stack, Text, useMedia } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import { themes } from "@linky-fit/ui/tokens";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Point } from "../copy";

const prefersReducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Rises into place the first time it scrolls into view. */
export function Reveal({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(prefersReducedMotion);
  return (
    <Stack
      gap="$none"
      ref={(node) => {
        if (visible || !(node instanceof Element)) return;
        const observer = new IntersectionObserver(
          ([entry]) => {
            if (!entry?.isIntersecting) return;
            setVisible(true);
            observer.disconnect();
          },
          { threshold: 0.12 },
        );
        observer.observe(node);
        return () => observer.disconnect();
      }}
      opacity={visible ? 1 : 0}
      y={visible ? 0 : 32}
      transition="slow"
    >
      {children}
    </Stack>
  );
}

/** A soft pool of gold light behind a phone. */
export function Glow() {
  return (
    <Stack
      aria-hidden
      position="absolute"
      inset={0}
      pointerEvents="none"
      backgroundImage={`radial-gradient(closest-side, ${themes.dark_fazole.accent}, transparent)`}
      opacity={0.28}
      filter="blur(40px)"
    />
  );
}

/** The fazole bean on its rounded tile. */
export function Logo({ size }: { size: number }) {
  return (
    <Image
      src="/logo-tile.webp"
      alt=""
      aria-hidden
      width={size}
      height={size}
      borderRadius={Math.round(size * 0.28)}
    />
  );
}

/** "Fazole", set like the logo. */
export function Wordmark() {
  return (
    <Text variant="title" color="$colorStrong">
      Fazole
    </Text>
  );
}

/** A short note in handwriting, like a pen mark on the page. */
export function Handwritten({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$handwriting"
      fontWeight="$semibold"
      fontSize={34}
      lineHeight={36}
      color="$accent"
    >
      {children}
    </Text>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  centered = false,
}: {
  eyebrow?: string | undefined;
  title: string;
  body?: string | undefined;
  centered?: boolean | undefined;
}) {
  const align = centered ? "center" : "left";
  return (
    <Stack
      gap="$md"
      maxWidth="$contentWidth"
      alignSelf={centered ? "center" : "flex-start"}
      alignItems={centered ? "center" : "flex-start"}
    >
      {eyebrow ? (
        <Text variant="label" bold color="$accentText" textAlign={align}>
          {eyebrow}
        </Text>
      ) : null}
      <Text
        variant="display"
        color="$colorStrong"
        role="heading"
        aria-level={2}
        textAlign={align}
      >
        {title}
      </Text>
      {body ? (
        <Text
          variant="title"
          fontWeight="$regular"
          color="$colorMuted"
          textAlign={align}
        >
          {body}
        </Text>
      ) : null}
    </Stack>
  );
}

/** An icon in a soft gold tile. */
export function IconTile({ icon }: { icon: IconName }) {
  return (
    <Stack
      width="$avatar"
      height="$avatar"
      flexShrink={0}
      alignItems="center"
      justifyContent="center"
      borderRadius="$control"
      backgroundColor="$accentSoft"
    >
      <Icon name={icon} color="$accentText" />
    </Stack>
  );
}

function PointText({ point }: { point: Point }) {
  return (
    <Stack flexShrink={1} gap="$xxs">
      <Text variant="title" color="$colorStrong">
        {point.title}
      </Text>
      <Text color="$colorMuted">{point.body}</Text>
    </Stack>
  );
}

/** Point cards in rows of `columns` on wide screens, stacked on phones. */
export function PointGrid({
  points,
  columns,
}: {
  points: readonly Point[];
  columns: number;
}) {
  const { wide } = useMedia();
  const card = (point: Point) => (
    <Card
      key={point.title}
      flex={wide ? 1 : undefined}
      flexBasis={wide ? 0 : undefined}
      gap="$lg"
      padding="$xxl"
    >
      <IconTile icon={point.icon} />
      <PointText point={point} />
    </Card>
  );
  if (!wide) return <Stack gap="$md">{points.map(card)}</Stack>;
  const rows = Array.from(
    { length: Math.ceil(points.length / columns) },
    (_, index) => points.slice(index * columns, (index + 1) * columns),
  );
  return (
    <Stack gap="$lg">
      {rows.map((row) => (
        <Row
          key={row.map((point) => point.title).join()}
          gap="$lg"
          alignItems="stretch"
        >
          {row.map(card)}
        </Row>
      ))}
    </Stack>
  );
}

/** A page section: its anchor and the vertical rhythm between sections. */
export function SiteSection({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const { wide } = useMedia();
  return (
    <Stack
      render="section"
      id={id}
      gap={wide ? "$huge" : "$xxxl"}
      paddingVertical={wide ? "$huge" : "$xxxl"}
    >
      {children}
    </Stack>
  );
}
