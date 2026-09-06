import {
  Copy as CopyIcon,
  Download,
  Pencil as EditIcon,
  Reply as ReplyIcon,
  Share2 as ShareIcon,
} from "lucide-react";
import type { FC } from "react";
import { createPortal } from "react-dom";
import { EmojiPicker } from "./EmojiPicker";

interface MessageImageActions {
  canShare: boolean;
  onSave: () => void;
  onShare: () => void;
}

interface MessageActionsMenuProps {
  canCopy: boolean;
  canEdit: boolean;
  canReplyOrReact: boolean;
  imageActions: MessageImageActions | null;
  isOpen: boolean;
  labels: {
    copy: string;
    edit: string;
    react: string;
    reply: string;
    save: string;
    share: string;
  };
  onClose: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
}

export const MessageActionsMenu: FC<MessageActionsMenuProps> = ({
  canCopy,
  canEdit,
  canReplyOrReact,
  imageActions,
  isOpen,
  labels,
  onClose,
  onCopy,
  onEdit,
  onReact,
  onReply,
}) => {
  if (!isOpen) return null;

  // Portaled to <body>: on iOS the chat scroller is a composited layer whose
  // stacking context would otherwise paint this fixed sheet below the compose bar.
  return createPortal(
    <>
      <div
        className="message-actions-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="message-actions-sheet" role="menu">
        <div className="message-actions-handle" aria-hidden="true" />
        {canReplyOrReact && (
          <EmojiPicker
            onSelect={(emoji) => {
              onReact(emoji);
              onClose();
            }}
          />
        )}
        <div className="message-actions-separator" />
        {canReplyOrReact && (
          <button
            type="button"
            className="message-actions-item"
            onClick={() => {
              onReply();
              onClose();
            }}
          >
            <span className="message-actions-icon">
              <ReplyIcon size={18} />
            </span>
            {labels.reply}
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            className="message-actions-item"
            onClick={() => {
              onEdit();
              onClose();
            }}
          >
            <span className="message-actions-icon">
              <EditIcon size={18} />
            </span>
            {labels.edit}
          </button>
        )}
        {imageActions?.canShare && (
          <button
            type="button"
            className="message-actions-item"
            onClick={() => {
              imageActions.onShare();
              onClose();
            }}
          >
            <span className="message-actions-icon">
              <ShareIcon size={18} />
            </span>
            {labels.share}
          </button>
        )}
        {imageActions && (
          <button
            type="button"
            className="message-actions-item"
            onClick={() => {
              imageActions.onSave();
              onClose();
            }}
          >
            <span className="message-actions-icon">
              <Download size={18} />
            </span>
            {labels.save}
          </button>
        )}
        {canCopy && (
          <button
            type="button"
            className="message-actions-item"
            onClick={() => {
              onCopy();
              onClose();
            }}
          >
            <span className="message-actions-icon">
              <CopyIcon size={18} />
            </span>
            {labels.copy}
          </button>
        )}
      </div>
    </>,
    document.body,
  );
};
