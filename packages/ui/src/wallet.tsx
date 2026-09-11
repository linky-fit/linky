import type { ReactNode } from "react";
import { Button } from "./controls";
import { Avatar } from "./people";
import { Row, Stack, Text } from "./layout";
import { paymentTones, StatusBadge } from "./status";
import type { PaymentState } from "./status";

export interface AmountProps {
  value: string;
  unit: string;
  size?: "regular" | "balance" | "payment";
  accent?: boolean;
}
export function Amount({
  value,
  unit,
  size = "regular",
  accent = false,
}: AmountProps) {
  return (
    <Row
      alignItems="baseline"
      flexWrap="wrap"
      gap="$xs"
      justifyContent="center"
    >
      <Text
        fontSize={size === "balance" ? 40 : size === "payment" ? 28 : 16}
        lineHeight={size === "balance" ? 52 : size === "payment" ? 36 : 24}
        fontWeight="700"
        color={accent ? "$accent" : "$color"}
        fontVariant={["tabular-nums"]}
        flexShrink={1}
      >
        {value}
      </Text>
      <Text fontSize={size === "balance" ? 20 : 16} muted>
        {unit}
      </Text>
    </Row>
  );
}
export interface WalletBalanceProps {
  label: string;
  value: string;
  unit: string;
  hint?: string;
  receiveLabel: string;
  sendLabel: string;
  onReceive: () => void;
  onSend: () => void;
  onAmountPress?: () => void;
  amountLabel?: string;
}
export function WalletBalance({
  label,
  value,
  unit,
  hint,
  receiveLabel,
  sendLabel,
  onReceive,
  onSend,
  onAmountPress,
  amountLabel,
}: WalletBalanceProps) {
  const amount = <Amount value={value} unit={unit} size="balance" accent />;
  return (
    <Stack gap="$md">
      <Stack alignItems="center" gap="$xs" paddingTop="$sm" paddingBottom="$md">
        <Text variant="label" fontWeight="400" muted textAlign="left">
          {label}
        </Text>
        {onAmountPress ? (
          <Button
            variant="ghost"
            onPress={onAmountPress}
            padding={0}
            aria-label={amountLabel ?? label}
          >
            {amount}
          </Button>
        ) : (
          amount
        )}
        {hint ? (
          <Text variant="caption" muted>
            {hint}
          </Text>
        ) : null}
      </Stack>
      <Row gap="$md" flexWrap="wrap">
        <Button
          flex={1}
          minHeight={52}
          minWidth={120}
          variant="secondary"
          icon="ArrowDownLeft"
          onPress={onReceive}
        >
          {receiveLabel}
        </Button>
        <Button
          flex={1}
          minHeight={52}
          minWidth={120}
          variant="secondary"
          icon="ArrowUpRight"
          onPress={onSend}
        >
          {sendLabel}
        </Button>
      </Row>
    </Stack>
  );
}
export interface ActivityRowProps {
  name: string;
  uri?: string;
  description: string;
  amount: string;
  unit: string;
  state: PaymentState;
  statusLabel: string;
  onPress?: () => void;
}
export function ActivityRow({
  name,
  uri,
  description,
  amount,
  unit,
  state,
  statusLabel,
  onPress,
}: ActivityRowProps) {
  const content = (
    <>
      <Avatar name={name} {...(uri ? { uri } : {})} />
      <Stack flex={1} gap="$xs">
        <Text variant="label" numberOfLines={1} textAlign="left">
          {name}
        </Text>
        <Text
          variant="label"
          fontWeight="400"
          muted
          numberOfLines={1}
          textAlign="left"
        >
          {description}
        </Text>
      </Stack>
      <Stack maxWidth="48%" alignItems="flex-end" gap="$xs">
        <Row gap="$xs" justifyContent="flex-end" flexWrap="wrap">
          <Text
            fontSize={15}
            lineHeight={20}
            fontWeight="600"
            fontVariant={["tabular-nums"]}
            flexShrink={1}
          >
            {amount}
          </Text>
          <Text variant="label" fontWeight="400">
            {unit}
          </Text>
        </Row>
        <StatusBadge label={statusLabel} tone={paymentTones[state]} />
      </Stack>
    </>
  );
  return (
    <Stack borderBottomWidth={1} borderColor="$borderColor">
      {onPress ? (
        <Button
          variant="ghost"
          justifyContent="flex-start"
          minHeight={66}
          borderRadius={0}
          paddingHorizontal={0}
          paddingVertical={10}
          gap="$lg"
          onPress={onPress}
        >
          {content}
        </Button>
      ) : (
        <Row minHeight={66} paddingVertical={10} gap="$lg">
          {content}
        </Row>
      )}
    </Stack>
  );
}
export interface SectionHeaderProps {
  title: string;
  action?: { label: string; onPress: () => void };
}
export function SectionHeader({ title, action }: SectionHeaderProps) {
  return (
    <Row minHeight={44} justifyContent="space-between">
      <Text variant="title" role="heading" flexShrink={1}>
        {title}
      </Text>
      {action ? (
        <Button
          variant="ghost"
          size="small"
          paddingHorizontal={0}
          onPress={action.onPress}
        >
          <Text variant="label" fontWeight="400" muted textAlign="left">
            {action.label}
          </Text>
        </Button>
      ) : null}
    </Row>
  );
}
export interface DateGroupProps {
  label: string;
  children: ReactNode;
}
export function DateGroup({ label, children }: DateGroupProps) {
  return (
    <Stack gap="$xs">
      <Text variant="label" fontWeight="400" muted paddingTop="$md">
        {label}
      </Text>
      {children}
    </Stack>
  );
}
