import { View } from "tamagui";
import { Pressable } from "./controls";
import { Text } from "./layout";
import { border } from "./tokens";
import type { Tone } from "./tokens";
import { toneColors } from "./styles";

export interface TimelineRowProps {
  time: string;
  channel: string;
  tag: string;
  summary: string;
  clientLabel?: string | undefined;
  tone?: Tone | undefined;
  selected?: boolean | undefined;
  related?: boolean | undefined;
  onPress: () => void;
  id?: string | undefined;
  testID?: string | undefined;
}

/** A compact diagnostic row with fixed columns, suitable for long timelines. */
export function TimelineRow({
  time,
  channel,
  tag,
  summary,
  clientLabel,
  tone = "neutral",
  selected = false,
  related = false,
  onPress,
  id,
  testID,
}: TimelineRowProps) {
  const colors = toneColors[tone];
  return (
    <Pressable
      {...(id ? { id } : {})}
      testID={testID}
      onPress={onPress}
      aria-pressed={selected}
      minWidth="$contentWidth"
      gap="$sm"
      paddingHorizontal="$sm"
      paddingVertical="$xs"
      backgroundColor={
        selected ? "$infoSoft" : related ? "$warningSoft" : "$transparent"
      }
      hoverStyle={{ backgroundColor: "$neutralSoft" }}
    >
      <View
        width={border.emphasis}
        alignSelf="stretch"
        backgroundColor={
          selected ? "$infoText" : related ? "$warningText" : "$transparent"
        }
      />
      <Text
        mono
        variant="caption"
        color="$colorMuted"
        width="$hero"
        flexShrink={0}
      >
        {time}
      </Text>
      {clientLabel ? (
        <Text
          mono
          variant="caption"
          color="$colorMuted"
          width="$row"
          flexShrink={0}
        >
          {clientLabel}
        </Text>
      ) : null}
      <Text
        mono
        variant="caption"
        bold
        color={colors.color}
        backgroundColor={colors.background}
        borderRadius="$sm"
        paddingHorizontal="$xs"
        width="$hero"
        flexShrink={0}
        numberOfLines={1}
      >
        {channel}
      </Text>
      <Text
        mono
        variant="caption"
        width="$column"
        flexShrink={0}
        numberOfLines={1}
      >
        {tag}
      </Text>
      <Text variant="caption" color="$colorMuted" flex={1} numberOfLines={1}>
        {summary}
      </Text>
    </Pressable>
  );
}
