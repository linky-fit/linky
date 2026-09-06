import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  getMessageEditorCaret,
  getMessageEditorEntityRanges,
  getMessageEditorValue,
  insertMessageEditorText,
  setMessageEditorCaret,
} from "../app/lib/messageEditorDom";
import type { CashuTokenMessageInfo } from "../app/lib/tokenMessageInfo";
import { deriveDefaultProfile } from "../derivedProfile";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import type { NpubMessageContactInfo } from "./ChatMessage";

const ENTITY_PATTERN =
  /(?:nostr:)?npub1[023456789acdefghjklmnpqrstuvwxyz]+(?:@npub\.cash)?|cashu[0-9A-Za-z_-]+={0,2}/gi;

interface ChatMessageEditorProps {
  disabled: boolean;
  getCashuTokenMessageInfo: (text: string) => CashuTokenMessageInfo | null;
  getMintIconUrl: (mint: string | null | undefined) => { url: string | null };
  getNpubMessageContactInfo: (npub: string) => NpubMessageContactInfo | null;
  onCaretChange: (caret: number) => void;
  onChange: (value: string) => void;
  onSendShortcut: () => void;
  placeholder: string;
  removeContactLabel: string;
  value: string;
}

const appendContactPill = (
  fragment: DocumentFragment,
  rawValue: string,
  info: NpubMessageContactInfo,
  removeContactLabel: string,
) => {
  const pill = document.createElement("span");
  pill.className = "pill chat-contact-pill chat-compose-inline-pill";
  pill.contentEditable = "false";
  pill.dataset.messageEntityValue = rawValue;
  pill.setAttribute(
    "aria-label",
    `${info.displayName} — ${removeContactLabel}`,
  );
  pill.title = removeContactLabel;

  const avatar = document.createElement("span");
  avatar.className = "chat-contact-pill-avatar";
  avatar.setAttribute("aria-hidden", "true");
  if (info.pictureUrl) {
    const image = document.createElement("img");
    image.src = info.pictureUrl;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    avatar.append(image);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "chat-contact-pill-avatar-fallback";
    fallback.textContent = deriveDefaultProfile(info.npub).name.charAt(0);
    avatar.append(fallback);
  }

  const label = document.createElement("span");
  label.className = "chat-contact-pill-label";
  label.textContent = info.displayName;
  const remove = document.createElement("span");
  remove.className = "chat-compose-contact-remove";
  remove.setAttribute("aria-hidden", "true");
  remove.textContent = "×";
  pill.append(avatar, label, remove);
  fragment.append(pill);
};

const removeEntityFromValue = (
  value: string,
  start: number,
  end: number,
): string => {
  const removeEnd = value[end] === " " ? end + 1 : end;
  const removeStart =
    removeEnd === end && start > 0 && value[start - 1] === " "
      ? start - 1
      : start;
  return `${value.slice(0, removeStart)}${value.slice(removeEnd)}`;
};

const appendCashuPill = (
  fragment: DocumentFragment,
  rawValue: string,
  info: CashuTokenMessageInfo,
  iconUrl: string | null,
  amountText: string,
) => {
  const pill = document.createElement("span");
  pill.className = info.isValid
    ? "pill cashu-token-pill chat-token-pill chat-compose-inline-pill"
    : "pill pill-muted cashu-token-pill chat-token-pill chat-compose-inline-pill";
  pill.contentEditable = "false";
  pill.dataset.messageEntityValue = rawValue;
  pill.setAttribute("aria-label", amountText);
  if (iconUrl) {
    const image = document.createElement("img");
    image.src = iconUrl;
    image.alt = "";
    image.width = 14;
    image.height = 14;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    pill.append(image);
  }
  const label = document.createElement("span");
  label.textContent = amountText;
  pill.append(label);
  fragment.append(pill);
};

export const ChatMessageEditor = React.forwardRef<
  HTMLDivElement,
  ChatMessageEditorProps
>(function ChatMessageEditor(
  {
    disabled,
    getCashuTokenMessageInfo,
    getMintIconUrl,
    getNpubMessageContactInfo,
    onCaretChange,
    onChange,
    onSendShortcut,
    placeholder,
    removeContactLabel,
    value,
  },
  forwardedRef,
) {
  const { formatDisplayedAmountText } = useAppShellCore();
  const localRef = React.useRef<HTMLDivElement | null>(null);
  const pendingCaretRef = React.useRef<number | null>(null);
  const lastRenderedValueRef = React.useRef<string | null>(null);

  const resolveEntity = React.useCallback(
    (rawValue: string) => {
      if (rawValue.toLowerCase().startsWith("cashu")) {
        return {
          contactInfo: null,
          tokenInfo: getCashuTokenMessageInfo(rawValue),
        };
      }
      const npub = normalizeNpubIdentifier(rawValue);
      return {
        contactInfo: npub ? getNpubMessageContactInfo(npub) : null,
        tokenInfo: null,
      };
    },
    [getCashuTokenMessageInfo, getNpubMessageContactInfo],
  );

  const setEditorRef = React.useCallback(
    (editor: HTMLDivElement | null) => {
      localRef.current = editor;
      if (typeof forwardedRef === "function") {
        forwardedRef(editor);
      } else if (forwardedRef) {
        forwardedRef.current = editor;
      }
    },
    [forwardedRef],
  );

  React.useLayoutEffect(() => {
    const editor = localRef.current;
    if (!editor || lastRenderedValueRef.current === value) return;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of value.matchAll(ENTITY_PATTERN)) {
      const rawValue = match[0];
      const start = match.index ?? 0;
      if (start > cursor)
        fragment.append(document.createTextNode(value.slice(cursor, start)));

      const { contactInfo, tokenInfo } = resolveEntity(rawValue);
      if (contactInfo) {
        appendContactPill(fragment, rawValue, contactInfo, removeContactLabel);
      } else if (tokenInfo) {
        appendCashuPill(
          fragment,
          rawValue,
          tokenInfo,
          getMintIconUrl(tokenInfo.mintUrl).url,
          formatDisplayedAmountText(tokenInfo.amount ?? 0),
        );
      } else {
        fragment.append(document.createTextNode(rawValue));
      }
      cursor = start + rawValue.length;
    }
    if (cursor < value.length)
      fragment.append(document.createTextNode(value.slice(cursor)));

    editor.replaceChildren(fragment);
    lastRenderedValueRef.current = value;
    const requestedCaret = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (requestedCaret !== null && document.activeElement === editor) {
      setMessageEditorCaret(editor, requestedCaret);
    }
  }, [
    formatDisplayedAmountText,
    getMintIconUrl,
    removeContactLabel,
    resolveEntity,
    value,
  ]);

  const publishEditorState = () => {
    const editor = localRef.current;
    if (!editor) return;
    const nextValue = getMessageEditorValue(editor);
    const caret = getMessageEditorCaret(editor);
    pendingCaretRef.current = caret;

    const renderedValues = Array.from(
      editor.querySelectorAll<HTMLElement>("[data-message-entity-value]"),
    ).map((element) => element.dataset.messageEntityValue ?? "");
    const expectedValues: string[] = [];
    for (const match of nextValue.matchAll(ENTITY_PATTERN)) {
      const rawValue = match[0];
      const { contactInfo, tokenInfo } = resolveEntity(rawValue);
      if (contactInfo || tokenInfo) expectedValues.push(rawValue);
    }
    if (
      renderedValues.length === expectedValues.length &&
      renderedValues.every(
        (rendered, index) => rendered === expectedValues[index],
      )
    ) {
      lastRenderedValueRef.current = nextValue;
    }
    onChange(nextValue);
    onCaretChange(caret);
  };

  return (
    <div
      ref={setEditorRef}
      className="chat-message-editor"
      contentEditable={!disabled}
      role="textbox"
      aria-multiline="true"
      aria-disabled={disabled}
      data-placeholder={placeholder}
      data-guide="chat-input"
      suppressContentEditableWarning
      tabIndex={disabled ? -1 : 0}
      onBeforeInput={(event) => {
        const editor = localRef.current;
        if (!editor) return;
        const nativeEvent = event.nativeEvent;
        if (nativeEvent.inputType === "insertParagraph") {
          event.preventDefault();
          insertMessageEditorText(editor, "\n");
          publishEditorState();
          return;
        }

        if (
          nativeEvent.inputType !== "deleteContentBackward" &&
          nativeEvent.inputType !== "deleteContentForward"
        ) {
          return;
        }
        const selection = window.getSelection();
        if (!selection?.isCollapsed) return;
        const caret = getMessageEditorCaret(editor);
        for (const entity of getMessageEditorEntityRanges(editor)) {
          const shouldDelete =
            nativeEvent.inputType === "deleteContentBackward"
              ? caret === entity.end
              : caret === entity.start;
          if (!shouldDelete) continue;
          event.preventDefault();
          const nextValue = `${value.slice(0, entity.start)}${value.slice(
            entity.end,
          )}`;
          pendingCaretRef.current = entity.start;
          onChange(nextValue);
          onCaretChange(entity.start);
          return;
        }
      }}
      onInput={publishEditorState}
      onClick={(event) => {
        const editor = localRef.current;
        if (!editor) return;
        const target = event.target;
        const contactPill =
          target instanceof Element
            ? target.closest<HTMLElement>(
                ".chat-contact-pill[data-message-entity-value]",
              )
            : null;
        if (contactPill && editor.contains(contactPill)) {
          const entityElements = Array.from(
            editor.querySelectorAll<HTMLElement>("[data-message-entity-value]"),
          );
          const entityIndex = entityElements.indexOf(contactPill);
          const entity = getMessageEditorEntityRanges(editor)[entityIndex];
          if (entity) {
            event.preventDefault();
            const currentValue = getMessageEditorValue(editor);
            const nextValue = removeEntityFromValue(
              currentValue,
              entity.start,
              entity.end,
            );
            pendingCaretRef.current = entity.start;
            onChange(nextValue);
            onCaretChange(entity.start);
            return;
          }
        }
        onCaretChange(getMessageEditorCaret(editor));
      }}
      onKeyUp={() => {
        const editor = localRef.current;
        if (editor) onCaretChange(getMessageEditorCaret(editor));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.metaKey) {
          event.preventDefault();
          onSendShortcut();
        }
      }}
      onPaste={(event) => {
        const editor = localRef.current;
        if (!editor) return;
        event.preventDefault();
        insertMessageEditorText(
          editor,
          event.clipboardData.getData("text/plain"),
        );
        publishEditorState();
      }}
    />
  );
});
