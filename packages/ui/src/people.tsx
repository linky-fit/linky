import type { ReactNode } from "react";
import { Avatar as TamaguiAvatar } from "tamagui";
import { Button } from "./controls";
import { Row, Stack, Text } from "./layout";

export interface AvatarProps {
  name: string;
  uri?: string;
  size?: "small" | "regular" | "large";
  label?: string;
}
export function Avatar({ name, uri, size = "regular", label }: AvatarProps) {
  const dimension = { small: 32, regular: 44, large: 68 }[size];
  const initials = name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase();
  return (
    <TamaguiAvatar
      circular
      size={dimension}
      flexShrink={0}
      backgroundColor="$surfaceRaised"
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      {uri ? (
        <TamaguiAvatar.Image src={uri} accessibilityLabel={label ?? ""} />
      ) : null}
      <TamaguiAvatar.Fallback
        alignItems="center"
        justifyContent="center"
        backgroundColor="$surfaceRaised"
      >
        <Text
          fontSize={size === "large" ? 24 : 16}
          fontWeight="600"
          color="$subtle"
        >
          {initials || "?"}
        </Text>
      </TamaguiAvatar.Fallback>
    </TamaguiAvatar>
  );
}
export interface PersonShortcutProps extends Pick<AvatarProps, "name" | "uri"> {
  label?: string;
  onPress: () => void;
}
export function PersonShortcut({
  name,
  uri,
  label = name,
  onPress,
}: PersonShortcutProps) {
  return (
    <Button
      variant="ghost"
      minWidth={68}
      maxWidth={112}
      padding={0}
      paddingBottom="$xs"
      onPress={onPress}
      aria-label={name}
    >
      <Stack alignItems="center" gap="$sm">
        <Avatar name={name} {...(uri ? { uri } : {})} size="large" />
        <Text
          variant="label"
          fontWeight="400"
          color="$subtle"
          numberOfLines={1}
        >
          {label}
        </Text>
      </Stack>
    </Button>
  );
}
export interface UnreadBadgeProps {
  count: number;
  label: string;
}
export function UnreadBadge({ count, label }: UnreadBadgeProps) {
  if (count <= 0) return null;
  return (
    <Stack
      minWidth={20}
      height={20}
      paddingHorizontal="$xs"
      borderRadius="$pill"
      backgroundColor="$accent"
      alignItems="center"
      justifyContent="center"
      aria-label={label}
    >
      <Text fontSize={11} lineHeight={16} fontWeight="700" color="$onAccent">
        {count > 99 ? "99+" : count}
      </Text>
    </Stack>
  );
}
export interface ContactRowProps {
  name: string;
  uri?: string;
  preview: string;
  time?: string;
  unreadCount?: number;
  unreadLabel?: string;
  onPress: () => void;
}
export function ContactRow({
  name,
  uri,
  preview,
  time,
  unreadCount = 0,
  unreadLabel = String(unreadCount),
  onPress,
}: ContactRowProps) {
  return (
    <Button
      variant="ghost"
      justifyContent="flex-start"
      minHeight={80}
      borderRadius={0}
      borderBottomWidth={1}
      borderColor="$surfaceRaised"
      paddingHorizontal={0}
      paddingVertical={14}
      onPress={onPress}
    >
      <Avatar name={name} {...(uri ? { uri } : {})} />
      <Stack flex={1} gap="$xs">
        <Text fontWeight="600" numberOfLines={1} textAlign="left">
          {name}
        </Text>
        <Text
          variant="label"
          fontWeight="400"
          muted
          numberOfLines={1}
          textAlign="left"
        >
          {preview}
        </Text>
      </Stack>
      <Stack gap="$xs" alignItems="flex-end" maxWidth="28%">
        {time ? (
          <Text variant="caption" muted>
            {time}
          </Text>
        ) : null}
        <UnreadBadge count={unreadCount} label={unreadLabel} />
      </Stack>
    </Button>
  );
}
export interface ListRowProps {
  title: string;
  description?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
}
export function ListRow({
  title,
  description,
  leading,
  trailing,
  onPress,
}: ListRowProps) {
  const content = (
    <>
      {leading}
      <Stack flex={1} gap="$xs">
        <Text fontWeight="600" textAlign="left">
          {title}
        </Text>
        {description ? (
          <Text variant="label" fontWeight="400" muted textAlign="left">
            {description}
          </Text>
        ) : null}
      </Stack>
      {trailing}
    </>
  );
  return onPress ? (
    <Button
      variant="ghost"
      minHeight={64}
      borderRadius={0}
      paddingHorizontal={0}
      justifyContent="flex-start"
      onPress={onPress}
    >
      {content}
    </Button>
  ) : (
    <Row minHeight={64}>{content}</Row>
  );
}
