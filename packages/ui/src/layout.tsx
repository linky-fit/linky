import type { ReactNode } from "react";
import {
  Anchor,
  ScrollView,
  Separator,
  styled,
  Text as TamaguiText,
  XStack,
  YStack,
} from "tamagui";
import type { GetProps } from "tamagui";
import { textVariant } from "./styles";
import { border, letterSpacing, shadow, space } from "./tokens";

export const Stack = styled(YStack, { name: "Stack", gap: "$md", minWidth: 0 });

export const Row = styled(XStack, {
  name: "Row",
  gap: "$md",
  alignItems: "center",
  minWidth: 0,
});

export const Text = styled(TamaguiText, {
  name: "Text",
  fontFamily: "$body",
  color: "$color",
  // Web buttons center their text; rows and labels read from the start.
  textAlign: "left",
  ...textVariant("body"),
  variants: {
    variant: {
      caption: textVariant("caption"),
      label: textVariant("label"),
      body: textVariant("body"),
      title: textVariant("title"),
      heading: textVariant("heading"),
      display: textVariant("display"),
      amount: textVariant("amount"),
      headline: {
        ...textVariant("headline"),
        letterSpacing: letterSpacing.headline,
      },
    },
    bold: { true: { fontWeight: "$bold" } },
    mono: { true: { fontFamily: "$mono" } },
    eyebrow: {
      true: {
        ...textVariant("caption"),
        fontWeight: "$bold",
        letterSpacing: letterSpacing.eyebrow,
        textTransform: "uppercase",
        color: "$colorMuted",
      },
    },
  } as const,
});

export interface TextLinkProps {
  href: string;
  children: ReactNode;
}

/** A link inside body text; links to other sites open in a new tab on the web. */
export function TextLink({ href, children }: TextLinkProps) {
  const external = /^https?:/u.test(href);
  return (
    <Anchor
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      color="$accentText"
      textDecorationLine="underline"
      fontFamily="$body"
      {...textVariant("body")}
      hoverStyle={{ color: "$accentHover" }}
    >
      {children}
    </Anchor>
  );
}

export interface BulletListProps {
  items: readonly ReactNode[];
}

/** A bulleted list of body text, e.g. the points of an article. */
export function BulletList({ items }: BulletListProps) {
  return (
    <Stack render="ul" gap="$xs" margin="$none" padding="$none">
      {items.map((item, index) => (
        <Row key={index} render="li" gap="$sm" alignItems="flex-start">
          <Text color="$colorMuted" aria-hidden>
            •
          </Text>
          <Text flex={1}>{item}</Text>
        </Row>
      ))}
    </Stack>
  );
}

export const Card = styled(YStack, {
  name: "Card",
  gap: "$md",
  padding: "$lg",
  borderRadius: "$card",
  backgroundColor: "$surface",
  minWidth: 0,
  variants: {
    elevated: { true: { boxShadow: shadow.floating } },
    outlined: {
      true: { borderWidth: border.hairline, borderColor: "$borderColor" },
    },
  } as const,
});

export const Divider = styled(Separator, {
  name: "Divider",
  borderColor: "$borderColor",
});

/** A page body with the app gutter. */
export const Screen = styled(YStack, {
  name: "Screen",
  flexGrow: 1,
  gap: "$lg",
  paddingHorizontal: "$xl",
  paddingVertical: "$lg",
  backgroundColor: "$background",
  minWidth: 0,
});

export interface SectionProps {
  title?: string | undefined;
  children: ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <Stack gap="$xs">
      {title ? (
        <Text eyebrow role="heading" paddingVertical="$sm">
          {title}
        </Text>
      ) : null}
      {children}
    </Stack>
  );
}

/** Scrolls a column of `ListRow`s vertically without clipping their highlights. */
export function ScrollList(props: GetProps<typeof ScrollView>) {
  return (
    <ScrollView
      // Outset by `$md`, the reach of ListRow highlights, and inset the content back.
      marginHorizontal={-space.md}
      contentContainerStyle={{ paddingHorizontal: space.md }}
      keyboardShouldPersistTaps="handled"
      {...props}
    />
  );
}

export { Image, ScrollView, Spacer } from "tamagui";
