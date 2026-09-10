import { Row, Text } from "./layout";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import type { ColorTokens } from "tamagui";
import type { Tone } from "./tokens";

export const toneStyles = {
  neutral: { color: "$muted", backgroundColor: "$surfaceRaised", icon: "Info" },
  success: {
    color: "$success",
    backgroundColor: "$successSoft",
    icon: "Check",
  },
  warning: {
    color: "$warning",
    backgroundColor: "$warningSoft",
    icon: "Clock",
  },
  danger: {
    color: "$danger",
    backgroundColor: "$dangerSoft",
    icon: "CircleAlert",
  },
  info: { color: "$info", backgroundColor: "$infoSoft", icon: "Info" },
} satisfies Record<
  Tone,
  { color: ColorTokens; backgroundColor: ColorTokens; icon: IconName }
>;
export type PaymentState = "completed" | "pending" | "failed";
export const paymentTones = {
  completed: "success",
  pending: "warning",
  failed: "danger",
} satisfies Record<PaymentState, Tone>;
export interface StatusBadgeProps {
  label: string;
  tone?: Tone;
  filled?: boolean;
}
export function StatusBadge({
  label,
  tone = "neutral",
  filled = false,
}: StatusBadgeProps) {
  const style = toneStyles[tone];
  return (
    <Row
      gap="$xs"
      alignSelf="flex-start"
      paddingHorizontal={filled ? "$sm" : 0}
      paddingVertical={filled ? "$xs" : 0}
      backgroundColor={filled ? style.backgroundColor : "$transparent"}
      borderRadius="$pill"
    >
      <Icon name={style.icon} size={14} color={style.color} />
      <Text fontSize={13} lineHeight={20} color={style.color} flexShrink={1}>
        {label}
      </Text>
    </Row>
  );
}
