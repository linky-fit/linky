import type { ReactNode } from "react";
import { Pressable } from "./controls";
import { Avatar, Pill } from "./display";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Stack, Text } from "./layout";
import { View } from "tamagui";
import { toneColors } from "./styles";
import { space } from "./tokens";
import type { Tone } from "./tokens";

export interface ListRowProps {
  title: ReactNode;
  description?: ReactNode;
  /** Small text above the trailing slot, e.g. a time. */
  meta?: string | undefined;
  /** A muted icon before the title; use `leading` for anything else. */
  icon?: IconName | undefined;
  /** Sets the icon on a tinted badge of this tone, e.g. for a hub's destinations. */
  iconTone?: Tone | undefined;
  leading?: ReactNode;
  /** Muted text at the end of the row, e.g. a setting's current value; a string title also labels it. */
  value?: string | number | undefined;
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  /** Defaults to true for pressable rows. */
  chevron?: boolean | undefined;
  /** The chosen option among others: a check mark replaces the chevron. */
  selected?: boolean | undefined;
  /** The item open beside the list, e.g. the conversation in the detail pane: the row is highlighted. */
  active?: boolean | undefined;
  /** Marks a row that shows or hides details below it. */
  expanded?: boolean | undefined;
  destructive?: boolean | undefined;
  disabled?: boolean | undefined;
  accessibilityLabel?: string | undefined;
  testID?: string | undefined;
}

/**
 * The single row primitive: settings links, options, transactions, mints and relays.
 * Its content lines up with the surrounding content; the press and selection highlight extends `$md` past it on both sides.
 */
export function ListRow({
  title,
  description,
  meta,
  icon,
  iconTone,
  leading,
  value,
  trailing,
  onPress,
  chevron = onPress !== undefined,
  selected = false,
  active = false,
  expanded,
  destructive = false,
  disabled = false,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const titleColor = destructive
    ? "$dangerText"
    : active
      ? "$accentText"
      : "$color";
  const Frame = onPress ? Pressable : Row;
  const background = active ? "$accentSoft" : "$transparent";
  const highlight = onPress && !active ? "$neutralSoft" : background;
  return (
    <Frame
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      aria-label={accessibilityLabel}
      aria-selected={selected || active}
      aria-expanded={expanded}
      gap="$md"
      minHeight="$controlLg"
      marginHorizontal={-space.md}
      paddingHorizontal="$md"
      paddingVertical="$sm"
      borderRadius="$control"
      backgroundColor={background}
      hoverStyle={{ backgroundColor: highlight }}
      pressStyle={{ backgroundColor: highlight }}
    >
      {icon && iconTone ? (
        <View
          padding="$sm"
          borderRadius="$control"
          backgroundColor={toneColors[iconTone].background}
        >
          <Icon name={icon} color={toneColors[iconTone].color} />
        </View>
      ) : icon ? (
        <Icon name={icon} size="sm" color="$colorMuted" />
      ) : (
        leading
      )}
      <Stack flex={1} gap="$xxs">
        <Row gap="$sm" alignItems="baseline">
          {typeof title === "string" ? (
            <Text flex={1} color={titleColor} numberOfLines={1}>
              {title}
            </Text>
          ) : (
            <Stack flex={1}>{title}</Stack>
          )}
          {meta ? (
            <Text variant="caption" color="$colorMuted" flexShrink={0}>
              {meta}
            </Text>
          ) : null}
        </Row>
        {typeof description === "string" ? (
          <Text variant="caption" color="$colorMuted" numberOfLines={2}>
            {description}
          </Text>
        ) : (
          description
        )}
      </Stack>
      {value !== undefined || trailing ? (
        <Row flexShrink={0} maxWidth="50%" justifyContent="flex-end">
          {value === undefined ? null : (
            <Text
              variant="label"
              color="$colorMuted"
              aria-label={typeof title === "string" ? title : undefined}
            >
              {value}
            </Text>
          )}
          {trailing}
        </Row>
      ) : null}
      {selected ? (
        <Icon name="Check" color="$accent" />
      ) : chevron ? (
        <Icon name="ChevronRight" size="sm" color="$colorMuted" />
      ) : null}
    </Frame>
  );
}

export interface ContactRowProps {
  name: string;
  /** The name the avatar initials come from, when `name` carries more, e.g. a disambiguating suffix. */
  avatarName?: string | undefined;
  avatarUri?: string | undefined;
  /** Shown in the avatar instead of initials without a photo. */
  avatarIcon?: IconName | undefined;
  /** The contact's own short status, muted after the name. */
  status?: string | undefined;
  preview?: ReactNode;
  time?: string | undefined;
  unread?: boolean | undefined;
  /** A short tag after the name, e.g. "unknown". */
  badge?: string | undefined;
  selected?: boolean | undefined;
  onPress: () => void;
  accessibilityLabel?: string | undefined;
}

export function ContactRow({
  name,
  avatarName,
  avatarUri,
  avatarIcon,
  status,
  preview,
  time,
  unread,
  badge,
  selected,
  onPress,
  accessibilityLabel,
}: ContactRowProps) {
  return (
    <ListRow
      leading={
        <Avatar
          name={avatarName ?? name}
          uri={avatarUri}
          icon={avatarIcon}
          indicator={unread ? "accent" : undefined}
        />
      }
      title={
        <Row gap="$sm">
          <Text
            fontWeight="$semibold"
            color={selected ? "$accentText" : "$colorStrong"}
            numberOfLines={1}
            flexShrink={1}
          >
            {name}
          </Text>
          {status ? (
            <Text
              variant="caption"
              color="$colorMuted"
              numberOfLines={1}
              flexShrink={1}
              dir="auto"
            >
              {status}
            </Text>
          ) : null}
          {badge ? <Pill label={badge} tone="warning" size="sm" /> : null}
        </Row>
      }
      description={preview}
      meta={time}
      chevron={false}
      active={selected}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? name}
    />
  );
}
