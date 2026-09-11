import type { ReactNode } from "react";
import QRCode from "react-native-qrcode-svg";
import { Icon } from "./icons";
import { Stack, Text } from "./layout";
import { Amount } from "./wallet";
import { paymentTones, toneStyles } from "./status";
import type { PaymentState } from "./status";
import { palette } from "./tokens";

export interface PaymentResultProps {
  state: PaymentState;
  title: string;
  description: string;
  amount: string;
  unit: string;
  action?: ReactNode;
  caption?: string;
}
export function PaymentResult({
  state,
  title,
  description,
  amount,
  unit,
  action,
  caption,
}: PaymentResultProps) {
  const tone = toneStyles[paymentTones[state]];
  return (
    <Stack alignItems="center" gap="$page" paddingTop="$xxxl">
      <Stack
        width={80}
        height={80}
        alignItems="center"
        justifyContent="center"
        borderRadius="$pill"
        backgroundColor={tone.backgroundColor}
      >
        <Icon name={tone.icon} size={36} color={tone.color} />
      </Stack>
      <Text variant="heading" role="heading" textAlign="center">
        {title}
      </Text>
      <Amount value={amount} unit={unit} size="balance" />
      <Text
        variant="label"
        fontWeight="400"
        muted
        maxWidth={320}
        textAlign="center"
      >
        {description}
      </Text>
      {action ? (
        <Stack alignSelf="stretch" marginTop="$xl">
          {action}
        </Stack>
      ) : null}
      {caption ? (
        <Text variant="caption" muted textAlign="center">
          {caption}
        </Text>
      ) : null}
    </Stack>
  );
}
export interface QRCodeCardProps {
  value: string;
  label: string;
  caption?: string;
  children?: ReactNode;
}
export function QRCodeCard({
  value,
  label,
  caption,
  children,
}: QRCodeCardProps) {
  return (
    <Stack alignItems="center" gap="$lg">
      <Stack
        backgroundColor="$white"
        padding="$md"
        borderRadius="$sm"
        role="img"
        aria-label={label}
      >
        {value ? (
          <QRCode
            value={value}
            size={196}
            color={palette.slate950}
            backgroundColor={palette.white}
          />
        ) : (
          <Text color="$slate950">{label}</Text>
        )}
      </Stack>
      {caption ? (
        <Text variant="caption" muted textAlign="center">
          {caption}
        </Text>
      ) : null}
      {children}
    </Stack>
  );
}
