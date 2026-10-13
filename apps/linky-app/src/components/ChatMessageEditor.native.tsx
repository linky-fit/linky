import { TextField } from "@linky-fit/ui";
import React from "react";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import type { NpubMessageContactInfo } from "./ChatMessage";

interface ChatMessageEditorProps {
  disabled: boolean;
  getCashuTokenMessageInfo: (text: string) => CashuTokenMessageInfo | null;
  getMintIconUrl: (mint: string | null | undefined) => { url: string | null };
  getNpubMessageContactInfo: (npub: string) => NpubMessageContactInfo | null;
  onCaretChange: (caret: number) => void;
  onChange: (value: string) => void;
  onPasteImages: (files: File[]) => void;
  onSendShortcut: () => void;
  placeholder: string;
  removeContactLabel: string;
  trailing?: React.ReactNode;
  value: string;
}

/** Plain text until the native editor with contact and token pills lands (P5b). */
export const ChatMessageEditor = React.forwardRef<
  HTMLDivElement,
  ChatMessageEditorProps
>(function ChatMessageEditor(
  { disabled, onCaretChange, onChange, placeholder, trailing, value },
  ref,
) {
  // ChatPage focuses the editor and moves its caret through a DOM node, which a native field is not.
  void ref;
  return (
    <TextField
      label={placeholder}
      hideLabel
      placeholder={placeholder}
      multiline
      value={value}
      disabled={disabled}
      trailing={trailing}
      onChangeText={onChange}
      onSelectionChange={(event) =>
        onCaretChange(event.nativeEvent.selection.end)
      }
    />
  );
});
