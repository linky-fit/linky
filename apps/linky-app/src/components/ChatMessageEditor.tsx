import {
  fontWeight,
  opacity,
  radius,
  RichTextInput,
  size,
  space,
  typography,
} from "@linky-fit/ui";
import React from "react";
import { useDisplayAmounts } from "../app/hooks/shell";
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
  onPasteImages: (files: File[]) => void;
  onSendShortcut: () => void;
  placeholder: string;
  removeContactLabel: string;
  trailing?: React.ReactNode;
  value: string;
}

type PillTone = "accent" | "neutral";

const pillColors: Record<PillTone, { background: string; color: string }> = {
  accent: { background: "var(--accentSoft)", color: "var(--accentText)" },
  neutral: { background: "var(--neutralSoft)", color: "var(--colorSubtle)" },
};

// The editor's DOM is built imperatively, so pills take token values as inline styles.
const createEntityPill = (
  kind: "contact" | "token",
  rawValue: string,
  tone: PillTone,
): HTMLSpanElement => {
  const pill = document.createElement("span");
  pill.contentEditable = "false";
  pill.dataset.messageEntityValue = rawValue;
  pill.dataset.messageEntityKind = kind;
  Object.assign(pill.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: `${space.xs}px`,
    margin: `0 ${space.xxs}px`,
    padding: `0 ${space.sm}px`,
    borderRadius: `${radius.pill}px`,
    verticalAlign: "middle",
    fontWeight: fontWeight.semibold,
    userSelect: kind === "contact" ? "none" : "all",
    cursor: kind === "contact" ? "pointer" : "text",
    ...pillColors[tone],
  });
  return pill;
};

const createPillImage = (url: string): HTMLImageElement => {
  const image = document.createElement("img");
  image.src = url;
  image.alt = "";
  image.loading = "lazy";
  image.referrerPolicy = "no-referrer";
  Object.assign(image.style, {
    width: `${size.iconSm}px`,
    height: `${size.iconSm}px`,
    borderRadius: `${radius.pill}px`,
    objectFit: "cover",
  });
  return image;
};

const appendContactPill = (
  fragment: DocumentFragment,
  rawValue: string,
  info: NpubMessageContactInfo,
  removeContactLabel: string,
) => {
  const pill = createEntityPill("contact", rawValue, "accent");
  pill.setAttribute(
    "aria-label",
    `${info.displayName} — ${removeContactLabel}`,
  );
  pill.title = removeContactLabel;

  const avatar = info.pictureUrl
    ? createPillImage(info.pictureUrl)
    : document.createElement("span");
  avatar.setAttribute("aria-hidden", "true");
  if (!info.pictureUrl) {
    avatar.textContent = deriveDefaultProfile(info.npub).name.charAt(0);
    Object.assign(avatar.style, {
      fontSize: `${typography.size.caption}px`,
      fontWeight: fontWeight.bold,
    });
  }

  const label = document.createElement("span");
  label.textContent = info.displayName;
  const remove = document.createElement("span");
  remove.setAttribute("aria-hidden", "true");
  remove.textContent = "×";
  remove.style.opacity = String(opacity.dimmed);
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
  const pill = createEntityPill(
    "token",
    rawValue,
    info.isValid ? "accent" : "neutral",
  );
  pill.setAttribute("aria-label", amountText);
  if (iconUrl) pill.append(createPillImage(iconUrl));
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
    onPasteImages,
    onSendShortcut,
    placeholder,
    removeContactLabel,
    trailing,
    value,
  },
  forwardedRef,
) {
  const { formatDisplayedAmountText } = useDisplayAmounts();
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
    <RichTextInput
      ref={setEditorRef}
      placeholder={placeholder}
      empty={value === ""}
      disabled={disabled}
      trailing={trailing}
      data-guide="chat-input"
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
                '[data-message-entity-kind="contact"]',
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
        if (disabled) return;
        const images = Array.from(event.clipboardData.files).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (images.length > 0) {
          onPasteImages(images);
          return;
        }
        insertMessageEditorText(
          editor,
          event.clipboardData.getData("text/plain"),
        );
        publishEditorState();
      }}
    />
  );
});
