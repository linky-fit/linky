import { Chip, Row } from "@linky-fit/ui";
import type { FC } from "react";
import type { ChatReactionChip } from "../app/types/appTypes";

interface MessageReactionsProps {
  onReact: (emoji: string) => void;
  reactions: readonly ChatReactionChip[];
}

const stopGesture = (event: { stopPropagation: () => void }) =>
  event.stopPropagation();

export const MessageReactions: FC<MessageReactionsProps> = ({
  onReact,
  reactions,
}) => {
  if (reactions.length === 0) return null;

  // The message owns long-press and swipe gestures; chip taps must not start them.
  return (
    <Row
      testID="message-reactions"
      gap="$xs"
      flexWrap="wrap"
      onPointerDown={stopGesture}
      onPointerMove={stopGesture}
      onPointerUp={stopGesture}
    >
      {reactions.map((reaction) => (
        <Chip
          key={reaction.emoji}
          label={
            reaction.count > 1
              ? `${reaction.emoji} ${reaction.count}`
              : reaction.emoji
          }
          selected={reaction.reactedByMe}
          onPress={() => onReact(reaction.emoji)}
        />
      ))}
    </Row>
  );
};
