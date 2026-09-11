import type { ReactNode } from "react";
import { Dialog as TamaguiDialog, ScrollView, Spinner } from "tamagui";
import { IconButton } from "./controls";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Stack, Text } from "./layout";
import { toneStyles } from "./status";
import type { Tone } from "./tokens";
import { useDialogBehavior } from "./dialogBehavior";

export interface NoticeProps {
  title: string;
  description?: string;
  tone?: Tone;
  icon?: IconName;
}
export function Notice({
  title,
  description,
  tone = "info",
  icon,
}: NoticeProps) {
  const style = toneStyles[tone];
  return (
    <Row
      padding="$md"
      borderRadius="$sm"
      backgroundColor={style.backgroundColor}
      alignItems="flex-start"
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon name={icon ?? style.icon} color={style.color} />
      <Stack flex={1} gap="$xs">
        <Text variant="label" color={style.color}>
          {title}
        </Text>
        {description ? (
          <Text variant="caption" color={style.color}>
            {description}
          </Text>
        ) : null}
      </Stack>
    </Row>
  );
}
export interface EmptyStateProps {
  title: string;
  description: string;
  icon: IconName;
  action?: ReactNode;
}
export function EmptyState({
  title,
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <Stack
      alignItems="center"
      paddingVertical="$xxxl"
      paddingHorizontal="$sm"
      gap="$md"
    >
      <Icon name={icon} size={36} color="$muted" />
      <Text variant="title" textAlign="center">
        {title}
      </Text>
      <Text
        variant="label"
        fontWeight="400"
        muted
        textAlign="center"
        maxWidth={320}
      >
        {description}
      </Text>
      {action ? (
        <Stack marginTop="$xl" alignSelf="stretch">
          {action}
        </Stack>
      ) : null}
    </Stack>
  );
}
export interface LoadingStateProps {
  label: string;
}
export function LoadingState({ label }: LoadingStateProps) {
  return (
    <Row role="status" aria-busy padding="$md">
      <Spinner color="$accent" />
      <Text variant="label" muted>
        {label}
      </Text>
    </Row>
  );
}
export interface ToastProps {
  message: string;
  tone?: Tone;
  dismissLabel: string;
  onDismiss: () => void;
}
export function Toast({
  message,
  tone = "success",
  dismissLabel,
  onDismiss,
}: ToastProps) {
  return (
    <Row
      role="status"
      padding="$sm"
      borderRadius="$control"
      backgroundColor="$surfaceRaised"
      shadowColor="$shadowColor"
      shadowOffset={{ width: 0, height: 8 }}
      shadowRadius={24}
    >
      <Icon name={toneStyles[tone].icon} color={toneStyles[tone].color} />
      <Text variant="label" flex={1}>
        {message}
      </Text>
      <IconButton label={dismissLabel} icon="X" onPress={onDismiss} />
    </Row>
  );
}
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  closeLabel: string;
  children: ReactNode;
}
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
}: DialogProps) {
  const focus = useDialogBehavior(open, onOpenChange);
  return (
    <TamaguiDialog modal open={open} onOpenChange={onOpenChange}>
      <TamaguiDialog.Portal role="presentation" aria-modal={undefined}>
        <TamaguiDialog.Overlay backgroundColor="$overlay" />
        <TamaguiDialog.Content
          {...focus}
          width={420}
          maxWidth="92%"
          maxHeight="90%"
          padding="$page"
          borderRadius="$card"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$borderColor"
          gap="$lg"
        >
          <Row>
            <TamaguiDialog.Title
              flex={1}
              fontFamily="$heading"
              fontSize={20}
              lineHeight={28}
              fontWeight="700"
              color="$color"
            >
              {title}
            </TamaguiDialog.Title>
            <IconButton
              label={closeLabel}
              icon="X"
              onPress={() => onOpenChange(false)}
            />
          </Row>
          <TamaguiDialog.Description
            fontFamily="$body"
            fontSize={14}
            lineHeight={20}
            color="$muted"
          >
            {description}
          </TamaguiDialog.Description>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: 16 }}
          >
            {children}
          </ScrollView>
        </TamaguiDialog.Content>
      </TamaguiDialog.Portal>
    </TamaguiDialog>
  );
}
