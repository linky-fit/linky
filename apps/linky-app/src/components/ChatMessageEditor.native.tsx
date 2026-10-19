import { RichTextInput } from "@linky-fit/ui";
import React from "react";
import { View } from "react-native";
import { useDisplayAmounts } from "../app/hooks/shell";
import { guideTargetRef } from "../app/lib/guideTargets";
import {
  applyDisplayEdit,
  caretAfterChange,
  displayOffsetOf,
  displayTextOf,
  messageEditorRuns,
  rawOffsetOf,
  type MessageEditorRun,
} from "../app/lib/messageEditorRuns";
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
 * The draft with known contacts shown by name and tokens by amount, each
 * edited as a whole, as the web editor's pills are. A native input holds
 * only text, so the labels stand in for the raw npub or token.
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
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const labelOf = React.useCallback(
    (raw: string): string | null => {
      if (raw.toLowerCase().startsWith("cashu")) {
        const token = getCashuTokenMessageInfo(raw);
        return token ? formatDisplayedAmountText(token.amount ?? 0) : null;
      }
      const npub = normalizeNpubIdentifier(raw);
      const contact = npub ? getNpubMessageContactInfo(npub) : null;
      return contact?.displayName || null;
    },
    [
      formatDisplayedAmountText,
      getCashuTokenMessageInfo,
      getNpubMessageContactInfo,
    ],
  );
  const runs = React.useMemo(
    () => messageEditorRuns(value, labelOf),
    [labelOf, value],
  );
  // Selection events can arrive before the render of the text they follow.
  const latestRuns = React.useRef<readonly MessageEditorRun[]>(runs);
  React.useLayoutEffect(() => {
    latestRuns.current = runs;
  }, [runs]);

  const [caret, setCaret] = React.useState<{ at: number } | undefined>(
    undefined,
  );
  const [typedValue, setTypedValue] = React.useState(value);
  const [shownValue, setShownValue] = React.useState(value);
  if (value !== shownValue) {
    setShownValue(value);
    if (value !== typedValue) {
      setTypedValue(value);
      setCaret({
        at: displayOffsetOf(runs, caretAfterChange(shownValue, value)),
      });
    }
  }

  return (
    <View ref={guideTargetRef("chat-input")}>
      <RichTextInput
        placeholder={placeholder}
        empty={value === ""}
        disabled={disabled}
        trailing={trailing}
        native={{
          segments: runs.map((run) => ({
            text: run.display,
            entity: run.entity,
          })),
          caret,
          onChangeText: (text) => {
            const next = applyDisplayEdit(latestRuns.current, text);
            const nextRuns = messageEditorRuns(next.value, labelOf);
            latestRuns.current = nextRuns;
            if (displayTextOf(nextRuns) !== text)
              setCaret({ at: displayOffsetOf(nextRuns, next.caret) });
            setTypedValue(next.value);
            onChange(next.value);
            onCaretChange(next.caret);
          },
          onCaretChange: (displayCaret) =>
            onCaretChange(rawOffsetOf(latestRuns.current, displayCaret)),
        }}
      />
    </View>
  );
});
