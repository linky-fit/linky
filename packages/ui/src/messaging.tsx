import { useState, type ReactNode } from "react";
import { Popover } from "tamagui";
import { Platform } from "react-native";
import { GrowingInput } from "./growing-input";
import { Button, IconButton } from "./controls";
import { Icon } from "./icons";
import { Row, Stack, Text } from "./layout";
import { Amount } from "./wallet";
import { StatusBadge, paymentTones } from "./status";
import type { PaymentState } from "./status";

export interface MessageBubbleProps {
  children: ReactNode;
  direction: "incoming" | "outgoing";
  time?: string;
  status?: string;
  reply?: ReactNode;
  reactions?: ReactNode;
  actions?: ReactNode;
  variant?: "text" | "payment";
}
export function MessageBubble({
  children,
  direction,
  time,
  status,
  reply,
  reactions,
  actions,
  variant = "text",
}: MessageBubbleProps) {
  const outgoing = direction === "outgoing";
  return (
    <Row
      justifyContent={outgoing ? "flex-end" : "flex-start"}
      alignItems="center"
      gap={2}
    >
      {outgoing ? actions : null}
      <Stack maxWidth={actions ? "82%" : "90%"} flexShrink={1} gap={0}>
        <Stack
          gap="$sm"
          backgroundColor={outgoing ? "$outgoing" : "$incoming"}
          borderRadius="$card"
          borderBottomLeftRadius={outgoing ? "$card" : 4}
          borderBottomRightRadius={outgoing ? 4 : "$card"}
          paddingVertical={variant === "payment" ? 16 : 12}
          paddingHorizontal={variant === "payment" ? 18 : 14}
        >
          {reply}
          {typeof children === "string" ? (
            <Text variant="message">{children}</Text>
          ) : (
            children
          )}
          {time || status ? (
            <Text
              variant="metadata"
              textAlign="right"
              color={outgoing ? "$accent" : "$muted"}
            >
              {[time, status].filter(Boolean).join(" · ")}
            </Text>
          ) : null}
        </Stack>
        {reactions ? (
          <Row gap="$xs" marginTop={-4} paddingHorizontal="$sm">
            {reactions}
          </Row>
        ) : null}
      </Stack>
      {!outgoing ? actions : null}
    </Row>
  );
}
export interface ReplyPreviewProps {
  author: string;
  body: string;
  onDismiss?: () => void;
  dismissLabel?: string;
}
export function ReplyPreview({
  author,
  body,
  onDismiss,
  dismissLabel = "Dismiss reply",
}: ReplyPreviewProps) {
  return (
    <Row backgroundColor="$surface" borderRadius="$sm" padding="$sm" gap="$sm">
      <Stack flex={1} gap="$xs">
        <Text variant="caption" fontWeight="600" color="$accent">
          {author}
        </Text>
        <Text variant="caption" muted numberOfLines={2}>
          {body}
        </Text>
      </Stack>
      {onDismiss ? (
        <IconButton label={dismissLabel} icon="X" onPress={onDismiss} />
      ) : null}
    </Row>
  );
}
export interface ReactionProps {
  label: string;
  count: number;
  selected: boolean;
  onPress: () => void;
}
export function Reaction({ label, count, selected, onPress }: ReactionProps) {
  return (
    <Button
      variant="ghost"
      size="small"
      padding={0}
      borderRadius="$pill"
      aria-pressed={selected}
      aria-label={`${label}, ${count}`}
      onPress={onPress}
    >
      <Row
        gap="$xs"
        paddingHorizontal="$sm"
        paddingVertical="$xs"
        borderRadius="$pill"
        backgroundColor={selected ? "$accentSoft" : "$surfaceRaised"}
      >
        <Icon name="Heart" size={12} color={selected ? "$accent" : "$muted"} />
        <Text
          fontSize={11}
          lineHeight={16}
          color={selected ? "$accent" : "$muted"}
        >
          {count}
        </Text>
      </Row>
    </Button>
  );
}

export interface MessageActionsProps {
  label: string;
  replyLabel: string;
  reactLabel: string;
  onReply: () => void;
  onReact: () => void;
}
export function MessageActions({
  label,
  replyLabel,
  reactLabel,
  onReply,
  onReact,
}: MessageActionsProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} placement="top" allowFlip>
      <Popover.Trigger asChild>
        <IconButton label={label} icon="MoreHorizontal" />
      </Popover.Trigger>
      <Popover.Content
        aria-label={label}
        backgroundColor="$surfaceRaised"
        borderRadius="$control"
        padding="$xs"
        minWidth={132}
        shadowColor="$shadowColor"
        shadowOffset={{ width: 0, height: 8 }}
        shadowRadius={24}
      >
        <Button
          variant="ghost"
          size="small"
          icon="Reply"
          justifyContent="flex-start"
          onPress={() => {
            setOpen(false);
            onReply();
          }}
        >
          {replyLabel}
        </Button>
        <Button
          variant="ghost"
          size="small"
          icon="Heart"
          justifyContent="flex-start"
          onPress={() => {
            setOpen(false);
            onReact();
          }}
        >
          {reactLabel}
        </Button>
      </Popover.Content>
    </Popover>
  );
}
export interface PaymentMessageProps {
  direction: MessageBubbleProps["direction"];
  kind?: "transfer" | "request";
  state: PaymentState;
  label: string;
  amount: string;
  unit: string;
  statusLabel: string;
  note?: string;
  time?: string;
  actions?: ReactNode;
}
export function PaymentMessage({
  direction,
  kind = "transfer",
  state,
  label,
  amount,
  unit,
  statusLabel,
  note,
  time,
  actions,
}: PaymentMessageProps) {
  return (
    <MessageBubble
      direction={direction}
      variant="payment"
      {...(time ? { time } : {})}
    >
      <Stack gap="$sm">
        <Row gap="$xs">
          <Icon
            name={
              kind === "request"
                ? "QrCode"
                : direction === "outgoing"
                  ? "ArrowUpRight"
                  : "ArrowDownLeft"
            }
            size={16}
            color="$subtle"
          />
          <Text variant="caption" flexShrink={1}>
            {label}
          </Text>
        </Row>
        <Stack alignItems="flex-start">
          <Amount value={amount} unit={unit} size="payment" />
        </Stack>
        {note ? (
          <Text variant="label" fontWeight="400">
            {note}
          </Text>
        ) : null}
        <StatusBadge label={statusLabel} tone={paymentTones[state]} />
        {actions}
      </Stack>
    </MessageBubble>
  );
}
export interface ChatPaymentActionProps {
  kind: "request" | "pay";
  children: string;
  onPress: () => void;
  disabled?: boolean;
}
export function ChatPaymentAction({
  kind,
  children,
  onPress,
  disabled,
}: ChatPaymentActionProps) {
  const color = kind === "pay" ? "$accent" : "$color";
  return (
    <Button
      variant="ghost"
      size="small"
      borderRadius="$pill"
      paddingVertical="$sm"
      paddingHorizontal={14}
      gap={6}
      backgroundColor={kind === "pay" ? "$accentSoft" : "$surface"}
      onPress={onPress}
      disabled={disabled}
    >
      <Icon
        name={kind === "pay" ? "ArrowUpRight" : "ArrowDownLeft"}
        size={16}
        color={color}
      />
      <Text fontSize={13} lineHeight={20} fontWeight="400" color={color}>
        {children}
      </Text>
    </Button>
  );
}
export interface MessageComposerProps {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  label: string;
  placeholder?: string;
  sendLabel: string;
  disabled?: boolean;
  sending?: boolean;
  canSend?: boolean;
  attachmentAction?: { label: string; onPress: () => void };
  attachments?: ReactNode;
  reply?: ReactNode;
  paymentActions?: ReactNode;
  caption?: string;
}
export function MessageComposer({
  value,
  onChangeText,
  onSend,
  label,
  placeholder,
  sendLabel,
  disabled = false,
  sending = false,
  canSend = value.trim().length > 0,
  attachmentAction,
  attachments,
  reply,
  paymentActions,
  caption,
}: MessageComposerProps) {
  const blocked = disabled || sending;
  const send = () => {
    if (!blocked && canSend) onSend();
  };
  return (
    <Stack gap={0}>
      {paymentActions ? (
        <Row justifyContent="flex-end" flexWrap="wrap" marginBottom={10}>
          {paymentActions}
        </Row>
      ) : null}
      {reply}
      {attachments}
      <Row
        gap="$xs"
        padding={3}
        borderRadius="$card"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$borderColor"
        focusWithinStyle={{ borderColor: "$accent" }}
        alignItems="center"
      >
        {attachmentAction ? (
          <IconButton
            label={attachmentAction.label}
            icon="Paperclip"
            color="$muted"
            disabled={blocked}
            onPress={attachmentAction.onPress}
          />
        ) : null}
        <GrowingInput
          unstyled
          flex={1}
          minWidth={0}
          minHeight={40}
          maxHeight={144}
          multiline
          scrollEnabled
          paddingVertical="$sm"
          paddingHorizontal="$xs"
          fontFamily="$body"
          fontSize={14}
          lineHeight={24}
          color="$color"
          placeholderTextColor="$placeholderColor"
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? label}
          aria-label={label}
          disabled={blocked}
          outlineStyle="none"
          focusStyle={{ outlineWidth: 0, outlineStyle: "none" }}
          focusVisibleStyle={{ outlineWidth: 0, outlineStyle: "none" }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          {...(Platform.OS === "web" ? {} : { onSubmitEditing: send })}
          returnKeyType="send"
        />
        <IconButton
          label={sendLabel}
          icon="Send"
          iconSize={20}
          variant="primary"
          disabled={blocked || !canSend}
          loading={sending}
          onPress={send}
        />
      </Row>
      {caption ? (
        <Text
          fontSize={10}
          lineHeight={16}
          paddingTop={9}
          textAlign="center"
          muted
        >
          {caption}
        </Text>
      ) : null}
    </Stack>
  );
}
