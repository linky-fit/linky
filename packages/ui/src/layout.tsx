import {
  styled,
  Text as TamaguiText,
  XStack,
  YStack,
  Separator,
} from "tamagui";
import type { GetProps } from "tamagui";
import { typography } from "./tokens";

function textStyle(value: (typeof typography)[keyof typeof typography]) {
  return {
    fontSize: value.size,
    lineHeight: value.lineHeight,
    fontWeight: value.weight,
  };
}
export const Stack = styled(YStack, {
  name: "NextStack",
  minWidth: 0,
  gap: "$lg",
});
export const Row = styled(XStack, {
  name: "NextRow",
  minWidth: 0,
  gap: "$md",
  alignItems: "center",
});
export const Surface = styled(Stack, {
  name: "NextSurface",
  padding: "$lg",
  borderRadius: "$card",
  backgroundColor: "$surface",
});
export const Divider = styled(Separator, {
  name: "NextDivider",
  borderColor: "$borderColor",
});
export const Text = styled(TamaguiText, {
  name: "NextText",
  minWidth: 0,
  fontFamily: "$body",
  color: "$color",
  ...textStyle(typography.body),
  variants: {
    variant: {
      caption: textStyle(typography.caption),
      label: textStyle(typography.label),
      body: textStyle(typography.body),
      title: textStyle(typography.title),
      heading: textStyle(typography.heading),
      display: textStyle(typography.display),
      amount: textStyle(typography.amount),
      message: { fontSize: 14, lineHeight: 23, fontWeight: "400" },
      metadata: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
    },
    muted: { true: { color: "$muted" } },
  },
});
export type TextProps = GetProps<typeof Text>;
export type StackProps = GetProps<typeof Stack>;
export type RowProps = GetProps<typeof Row>;
export type SurfaceProps = GetProps<typeof Surface>;
