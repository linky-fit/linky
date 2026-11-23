import { View } from "tamagui";
import { Pressable } from "./controls";
import { Row, Text } from "./layout";
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

/** A compact diagnostic row with fixed columns on wide screens and a wrapped layout on phones. */
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
      $compact={{
        minWidth: 0,
        width: "100%",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "$xs",
        paddingVertical: "$sm",
      }}
      backgroundColor={
        selected ? "$infoSoft" : related ? "$warningSoft" : "$transparent"
      }
      hoverStyle={{ backgroundColor: "$neutralSoft" }}
    >
      <View
        width={border.emphasis}
        alignSelf="stretch"
        $compact={{ display: "none" }}
        backgroundColor={
          selected ? "$infoText" : related ? "$warningText" : "$transparent"
        }
      />
      <Row gap="$sm" flexShrink={0} $compact={{ flexWrap: "wrap", gap: "$xs" }}>
        <Text
          mono
          variant="caption"
          color="$colorMuted"
          width="$hero"
          $compact={{ width: "auto" }}
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
            $compact={{ width: "auto" }}
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
          $compact={{ width: "auto" }}
          flexShrink={0}
          numberOfLines={1}
        >
          {channel}
        </Text>
      </Row>
      <Row
        gap="$sm"
        flex={1}
        minWidth={0}
        $compact={{
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: "auto",
          width: "100%",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "$xxs",
        }}
      >
        <Text
          mono
          variant="caption"
          width="$column"
          $compact={{ width: "100%" }}
          flexShrink={0}
          numberOfLines={1}
        >
          {tag}
        </Text>
        <Text
          variant="caption"
          color="$colorMuted"
          flex={1}
          $compact={{
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: "auto",
            width: "100%",
          }}
          numberOfLines={2}
        >
          {summary}
        </Text>
      </Row>
    </Pressable>
  );
}
