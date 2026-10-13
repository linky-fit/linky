import { RichTextInput, type RichTextSegment } from "@linky-fit/ui";
import React from "react";
import { MESSAGE_ENTITY_PATTERN } from "../app/lib/messageEditorEntities";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
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

/**
 * The draft with known contacts and tokens standing out. A native input
 * cannot hold the web editor's pills, so they keep their text.
 */
export const ChatMessageEditor = React.forwardRef<
  HTMLDivElement,
  ChatMessageEditorProps
>(function ChatMessageEditor(
  {
    disabled,
    getCashuTokenMessageInfo,
    getNpubMessageContactInfo,
    onCaretChange,
    onChange,
    placeholder,
    trailing,
    value,
  },
  ref,
) {
  // ChatPage focuses the editor and moves its caret through a DOM node, which a native input is not.
  void ref;
  const segments = React.useMemo(() => {
    const isEntity = (text: string) => {
      if (text.toLowerCase().startsWith("cashu"))
        return getCashuTokenMessageInfo(text) !== null;
      const npub = normalizeNpubIdentifier(text);
      return npub !== null && getNpubMessageContactInfo(npub) !== null;
    };
    const runs: RichTextSegment[] = [];
    let cursor = 0;
    for (const match of value.matchAll(MESSAGE_ENTITY_PATTERN)) {
      const start = match.index;
      if (start > cursor) runs.push({ text: value.slice(cursor, start) });
      runs.push({ text: match[0], entity: isEntity(match[0]) });
      cursor = start + match[0].length;
    }
    if (cursor < value.length) runs.push({ text: value.slice(cursor) });
    return runs;
  }, [getCashuTokenMessageInfo, getNpubMessageContactInfo, value]);

  return (
    <RichTextInput
      placeholder={placeholder}
      empty={value === ""}
      disabled={disabled}
      trailing={trailing}
      native={{ segments, onChangeText: onChange, onCaretChange }}
    />
  );
});
