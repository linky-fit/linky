import {
  Divider,
  EmojiCatalog,
  EmojiPicker,
  ListRow,
  Sheet,
} from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import { useMemo, useState, type FC } from "react";
import {
  QUICK_REACTION_EMOJIS,
  REACTION_EMOJI_GROUPS,
  type ReactionEmojiGroupId,
} from "../app/lib/reactionEmojis";

interface MessageImageActions {
  canShare: boolean;
  onSave: () => void;
  onShare: () => void;
}

interface MessageActionsMenuProps {
  canCopy: boolean;
  canDelete: boolean;
  canEdit: boolean;
  canReplyOrReact: boolean;
  imageActions: MessageImageActions | null;
  isOpen: boolean;
  labels: {
    copy: string;
    delete: string;
    edit: string;
    emojiGroups: Record<ReactionEmojiGroupId, string>;
    menu: string;
    moreEmojis: string;
    react: string;
    reply: string;
    save: string;
    share: string;
  };
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
}

interface MenuAction {
  icon: IconName;
  label: string;
  run: () => void;
}

export const MessageActionsMenu: FC<MessageActionsMenuProps> = ({
  canCopy,
  canDelete,
  canEdit,
  canReplyOrReact,
  imageActions,
  isOpen,
  labels,
  onClose,
  onCopy,
  onDelete,
  onEdit,
  onReact,
  onReply,
}) => {
  const [emojisExpanded, setEmojisExpanded] = useState(false);
  const emojiGroups = useMemo(
    () =>
      REACTION_EMOJI_GROUPS.map((group) => ({
        key: group.id,
        label: labels.emojiGroups[group.id],
        icon: group.icon,
        emojis: group.emojis,
      })),
    [labels.emojiGroups],
  );
  // Every message has its own menu and a closing Sheet lingers in the DOM, so mount it only while open.
  if (!isOpen) return null;
  const actions: MenuAction[] = [];
  if (canReplyOrReact)
    actions.push({ icon: "Reply", label: labels.reply, run: onReply });
  if (canEdit)
    actions.push({ icon: "Pencil", label: labels.edit, run: onEdit });
  if (imageActions?.canShare)
    actions.push({
      icon: "Share2",
      label: labels.share,
      run: imageActions.onShare,
    });
  if (imageActions)
    actions.push({
      icon: "Download",
      label: labels.save,
      run: imageActions.onSave,
    });
  if (canCopy) actions.push({ icon: "Copy", label: labels.copy, run: onCopy });
  if (canDelete)
    actions.push({ icon: "Trash2", label: labels.delete, run: onDelete });
  const close = () => {
    setEmojisExpanded(false);
    onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={labels.menu}
      hideTitle
    >
      {canReplyOrReact ? (
        emojisExpanded ? (
          <EmojiCatalog
            accessibilityLabel={labels.react}
            groups={emojiGroups}
            onSelect={(emoji) => {
              onReact(emoji);
              close();
            }}
          />
        ) : (
          <EmojiPicker
            accessibilityLabel={labels.react}
            emojis={QUICK_REACTION_EMOJIS}
            onSelect={(emoji) => {
              onReact(emoji);
              close();
            }}
            more={{
              label: labels.moreEmojis,
              onPress: () => setEmojisExpanded(true),
            }}
          />
        )
      ) : null}
      <Divider />
      {actions.map((action) => (
        <ListRow
          key={action.label}
          testID="message-action"
          icon={action.icon}
          title={action.label}
          chevron={false}
          onPress={() => {
            action.run();
            close();
          }}
        />
      ))}
    </Sheet>
  );
};
