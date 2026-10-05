import { useState } from "react";
import type { ReactNode } from "react";
import { View } from "tamagui";
import { Button, IconButton, Pressable } from "./controls";
import type { LabeledAction } from "./controls";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Stack, Text } from "./layout";
import { Spinner } from "./spinner";
import { toneColors, toneIcons } from "./styles";
import type { Tone } from "./tokens";
import { border, enterScale, shadow, space } from "./tokens";

export interface NoticeProps {
  title: string;
  description?: ReactNode;
  tone?: Tone | undefined;
  icon?: IconName | undefined;
  /** An app-wide banner: a compact accent strip with the action at the end of its row. */
  solid?: boolean | undefined;
  action?: LabeledAction | undefined;
  /** Shows a close button; `label` is its accessibility label. */
  dismiss?: LabeledAction | undefined;
}

export function Notice({
  title,
  description,
  tone = "info",
  icon,
  solid = false,
  action,
  dismiss,
}: NoticeProps) {
  const colors = toneColors[tone];
  const color = solid ? "$onAccent" : colors.color;
  const actionButton = action ? (
    <Button
      size="sm"
      variant={solid ? "secondary" : "ghost"}
      alignSelf={solid ? "center" : "flex-start"}
      onPress={action.onPress}
    >
      {action.label}
    </Button>
  ) : null;
  return (
    <Row
      alignItems={solid ? "center" : "flex-start"}
      gap="$sm"
      paddingHorizontal="$md"
      paddingVertical={solid ? "$sm" : "$md"}
      borderRadius={solid ? undefined : "$control"}
      backgroundColor={solid ? "$accent" : colors.background}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon name={icon ?? toneIcons[tone]} color={color} />
      <Stack flex={1} gap="$xxs">
        <Text variant="label" color={color}>
          {title}
        </Text>
        {typeof description === "string" ? (
          <Text variant="caption" color={solid ? "$onAccent" : "$colorSubtle"}>
            {description}
          </Text>
        ) : (
          description
        )}
        {solid ? null : actionButton}
      </Stack>
      {solid ? actionButton : null}
      {dismiss ? (
        <IconButton
          icon="X"
          accessibilityLabel={dismiss.label}
          size="sm"
          onPress={dismiss.onPress}
        />
      ) : null}
    </Row>
  );
}

/** A toast is either pressable as a whole or carries one action button. */
export type ToastProps =
  | { title: string; action?: LabeledAction | undefined; onPress?: never }
  | { title: string; onPress: () => void; action?: never };

export function Toast({ title, action, onPress }: ToastProps) {
  const Frame = onPress ? Pressable : Row;
  return (
    <Frame
      onPress={onPress}
      gap="$md"
      paddingHorizontal="$md"
      paddingVertical="$sm"
      minHeight="$control"
      maxWidth="$sheetWidth"
      borderRadius="$control"
      borderWidth={border.hairline}
      borderColor="$borderColor"
      backgroundColor="$surface"
      boxShadow={shadow.raised}
    >
      <Text variant="label" fontWeight="$regular" flex={1}>
        {title}
      </Text>
      {action ? (
        <Button size="sm" variant="ghost" onPress={action.onPress}>
          {action.label}
        </Button>
      ) : null}
    </Frame>
  );
}

/** Positions toasts at the top edge, above every overlay. */
export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <Stack
      position="absolute"
      top="$huge"
      right="$md"
      left="$md"
      alignItems="flex-end"
      gap="$sm"
      zIndex="$toast"
      pointerEvents="box-none"
      aria-live="polite"
    >
      {children}
    </Stack>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <Row justifyContent="center" padding="$lg" role="status" aria-busy>
      <Spinner />
      <Text variant="label" color="$colorMuted">
        {label}
      </Text>
    </Row>
  );
}

export interface StatusLineProps {
  label: string;
  /** Shows a spinner before the label while the app waits. */
  busy?: boolean | undefined;
  /** Rounds the corners, for a line that does not span the window. */
  rounded?: boolean | undefined;
}

/** A quiet full-width line that reports a background state, e.g. waiting for sync. */
export function StatusLine({
  label,
  busy = false,
  rounded = false,
}: StatusLineProps) {
  return (
    <Row
      gap="$sm"
      paddingVertical="$sm"
      paddingHorizontal="$xl"
      borderRadius={rounded ? "$sm" : undefined}
      backgroundColor="$neutralSoft"
      role="status"
      aria-live="polite"
    >
      {busy ? <Spinner color="$colorMuted" /> : null}
      <Text variant="caption" color="$colorMuted" flex={1}>
        {label}
      </Text>
    </Row>
  );
}

export interface ProgressProps {
  /** Between 0 and `max`. */
  value: number;
  max?: number | undefined;
  accessibilityLabel: string;
  tone?: Tone | undefined;
  /** Splits the track into equal steps that fill whole, e.g. phases of a flow. */
  segments?: number | undefined;
}

export function Progress({
  value,
  max = 1,
  accessibilityLabel,
  tone = "accent",
  segments,
}: ProgressProps) {
  const ratio = value / max;
  const fraction = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  const fill = toneColors[tone].solid;
  const a11y = {
    role: "progressbar",
    "aria-label": accessibilityLabel,
    "aria-valuemin": 0,
    "aria-valuemax": max,
    "aria-valuenow": fraction * max,
  } as const;
  if (segments) {
    const filled = Math.round(fraction * segments);
    return (
      <Row {...a11y} gap="$xs">
        {Array.from({ length: segments }, (_, index) => (
          <View
            key={index}
            flex={1}
            height="$track"
            borderRadius="$pill"
            backgroundColor={index < filled ? fill : "$neutralSoft"}
          />
        ))}
      </Row>
    );
  }
  return (
    <View
      {...a11y}
      height="$track"
      borderRadius="$pill"
      overflow="hidden"
      backgroundColor="$neutralSoft"
    >
      <View
        height="100%"
        width={`${fraction * 100}%`}
        borderRadius="$pill"
        backgroundColor={fill}
      />
    </View>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string | undefined;
  icon?: IconName | undefined;
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
      gap="$md"
      paddingVertical="$xxxl"
      paddingHorizontal="$xl"
    >
      {icon ? (
        <View padding="$lg" borderRadius="$pill" backgroundColor="$accentSoft">
          <Icon name={icon} size="lg" color="$accentText" />
        </View>
      ) : null}
      <Text variant="title" textAlign="center">
        {title}
      </Text>
      {description ? (
        <Text color="$colorMuted" textAlign="center">
          {description}
        </Text>
      ) : null}
      {action}
    </Stack>
  );
}

export interface EdgeStatusItem {
  label: string;
  tone: Tone;
  /** Shows a spinner instead of the dot while the step is under way. */
  busy?: boolean | undefined;
}

export interface EdgeStatusProps {
  /** Colors the tab; the panel's heading and the tab's name. */
  tone: Tone;
  label: string;
  items: readonly EdgeStatusItem[];
  action?: LabeledAction | undefined;
}

/**
 * A half-disc tab that reports a background state from the window's right
 * edge; hovering or pressing it opens a panel with the details above it. The
 * caller positions it.
 */
export function EdgeStatus({ tone, label, items, action }: EdgeStatusProps) {
  const [open, setOpen] = useState<"hover" | "press" | null>(null);
  return (
    <>
      {open === "press" ? (
        <Stack position="fixed" inset={0} onPress={() => setOpen(null)} />
      ) : null}
      {/* Positioned, so it paints above the fixed backdrop before it. */}
      <Stack
        position="relative"
        alignItems="flex-end"
        onMouseEnter={() => setOpen((current) => current ?? "hover")}
        onMouseLeave={() =>
          setOpen((current) => (current === "hover" ? null : current))
        }
      >
        {open ? (
          <Stack
            role="status"
            aria-live="polite"
            gap="$sm"
            width="$device"
            marginRight="$md"
            marginBottom="$sm"
            padding="$lg"
            borderRadius="$card"
            borderWidth={border.hairline}
            borderColor="$borderColor"
            backgroundColor="$surface"
            boxShadow={shadow.raised}
            transition="base"
            enterStyle={{ opacity: 0, scale: enterScale.subtle, y: space.md }}
          >
            <Text variant="label" bold>
              {label}
            </Text>
            {items.map((item) => (
              <Row key={item.label} gap="$sm" alignItems="center">
                {item.busy ? (
                  <Spinner color="$colorMuted" />
                ) : (
                  <View
                    width="$dot"
                    height="$dot"
                    borderRadius="$pill"
                    backgroundColor={toneColors[item.tone].solid}
                  />
                )}
                <Text variant="caption" color="$colorSubtle" flex={1}>
                  {item.label}
                </Text>
              </Row>
            ))}
            {action ? (
              <Button size="sm" variant="secondary" onPress={action.onPress}>
                {action.label}
              </Button>
            ) : null}
          </Stack>
        ) : null}
        <Pressable
          aria-label={label}
          aria-expanded={open !== null}
          paddingLeft="$md"
          paddingVertical="$md"
          onPress={() =>
            setOpen((current) => (current === "press" ? null : "press"))
          }
        >
          <View
            width="$dot"
            height="$iconSm"
            borderTopLeftRadius="$pill"
            borderBottomLeftRadius="$pill"
            backgroundColor={toneColors[tone].solid}
          />
        </Pressable>
      </Stack>
    </>
  );
}
