import { useState } from "react";
import type { ReactNode, Ref } from "react";
import {
  AnimatePresence,
  Anchor,
  Image,
  ScrollView,
  Theme,
  View,
} from "tamagui";
import type { GetProps, TamaguiElement } from "tamagui";
import { IconButton, Pressable } from "./controls";
import type { LabeledAction, PressableProps } from "./controls";
import { textVariant, toneColors } from "./styles";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { Row, Stack, Text } from "./layout";
import type { Tone } from "./tokens";
import { border, enterScale, opacity, radius, space } from "./tokens";

/** Where a message sits in a run of messages from one sender; the corners facing its neighbours tighten. */
export type MessageGroupPosition = "single" | "first" | "middle" | "last";

/** Other view props (handlers, a ref, data attributes) reach the message's outer view. */
export interface MessageBubbleProps extends Omit<
  GetProps<typeof Stack>,
  "children" | "direction" | "testID"
> {
  ref?: Ref<TamaguiElement> | undefined;
  direction: "incoming" | "outgoing";
  children: ReactNode;
  /** Sits at the bubble's end, beside short text and below long content; a string renders as a muted caption. */
  time?: ReactNode;
  /** Not yet delivered: dimmed. */
  pending?: boolean | undefined;
  /** Puts the time on its own line under the content, e.g. under a card's actions. */
  timeBelow?: boolean | undefined;
  /** Defaults to a message on its own. */
  groupPosition?: MessageGroupPosition | undefined;
  /** Content below the bubble, e.g. reactions. */
  footer?: ReactNode;
  /** Shown beside the bubble on the inner side, outside its width, e.g. an actions button. */
  accessory?: ReactNode;
  testID?: string | undefined;
}

/** Each corner is set on its own: a shorthand radius would override the joined corners. */
const groupedCorners = (outgoing: boolean, position: MessageGroupPosition) => {
  const joinsAbove = position === "middle" || position === "last";
  const joinsBelow = position === "first" || position === "middle";
  const top = joinsAbove ? radius.messageJoin : radius.message;
  const bottom = joinsBelow ? radius.messageJoin : radius.message;
  return {
    borderTopLeftRadius: outgoing ? radius.message : top,
    borderBottomLeftRadius: outgoing ? radius.message : bottom,
    borderTopRightRadius: outgoing ? top : radius.message,
    borderBottomRightRadius: outgoing ? bottom : radius.message,
  };
};

export function MessageBubble({
  direction,
  children,
  time,
  pending = false,
  timeBelow = false,
  groupPosition = "single",
  footer,
  accessory,
  testID,
  ...props
}: MessageBubbleProps) {
  const outgoing = direction === "outgoing";
  const startsGroup = groupPosition === "single" || groupPosition === "first";
  return (
    <Stack
      {...props}
      alignSelf={outgoing ? "flex-end" : "flex-start"}
      alignItems={outgoing ? "flex-end" : "flex-start"}
      maxWidth="85%"
      gap="$xs"
      marginTop={startsGroup ? "$sm" : "$none"}
    >
      <Stack position="relative" maxWidth="100%">
        <Theme name={outgoing ? "outgoing" : null}>
          <Row
            testID={testID}
            flexWrap="wrap"
            // A column keeps the time line out of the bubble's width, so a card sets it alone.
            flexDirection={timeBelow ? "column" : "row"}
            alignItems={timeBelow ? "stretch" : "flex-end"}
            columnGap="$sm"
            rowGap="$none"
            paddingHorizontal="$md"
            paddingVertical="$sm"
            {...groupedCorners(outgoing, groupPosition)}
            backgroundColor={outgoing ? "$background" : "$bubble"}
            opacity={pending ? opacity.dimmed : 1}
          >
            <Stack gap="$xs" flexShrink={1} maxWidth="100%">
              {typeof children === "string" ? (
                <Text userSelect="text">{children}</Text>
              ) : (
                children
              )}
            </Stack>
            {time ? (
              // Grows into the line's spare width, so the time stays at the end even when it wraps below wide content.
              <Row flexGrow={1} flexShrink={0} justifyContent="flex-end">
                {typeof time === "string" ? (
                  <Text variant="caption" color="$colorMuted">
                    {time}
                  </Text>
                ) : (
                  time
                )}
              </Row>
            ) : null}
          </Row>
        </Theme>
        {accessory ? (
          // A zero-width anchor on the bubble's edge lets the accessory overflow outward.
          <Row
            position="absolute"
            top="$none"
            bottom="$none"
            width="$none"
            gap="$none"
            justifyContent={outgoing ? "flex-end" : "flex-start"}
            {...(outgoing ? { left: "$none" } : { right: "$none" })}
          >
            {accessory}
          </Row>
        ) : null}
      </Stack>
      {footer}
    </Stack>
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <Text
      variant="caption"
      bold
      color="$colorMuted"
      alignSelf="center"
      flexShrink={0}
      marginVertical="$sm"
      paddingHorizontal="$md"
      paddingVertical="$xs"
      borderRadius="$pill"
      overflow="hidden"
      backgroundColor="$surface"
    >
      {label}
    </Text>
  );
}

export interface ReplyPreviewProps {
  author: string;
  body: string;
  onPress?: (() => void) | undefined;
  /** Shows a close button; `label` is its accessibility label. */
  dismiss?: LabeledAction | undefined;
}

export function ReplyPreview({
  author,
  body,
  onPress,
  dismiss,
}: ReplyPreviewProps) {
  const Quote = onPress ? Pressable : Stack;
  return (
    <Row
      gap="$sm"
      padding="$sm"
      borderRadius="$control"
      backgroundColor="$neutralSoft"
    >
      <Quote
        onPress={onPress}
        flex={1}
        alignItems="stretch"
        flexDirection="row"
        gap="$sm"
      >
        <QuoteBar />
        <Stack flex={1} gap="$xxs">
          <Text variant="caption" bold color="$accentText" numberOfLines={1}>
            {author}
          </Text>
          <Text variant="caption" color="$colorSubtle" numberOfLines={2}>
            {body}
          </Text>
        </Stack>
      </Quote>
      {dismiss ? (
        <IconButton
          icon="X"
          accessibilityLabel={dismiss.label}
          size="sm"
          onPress={dismiss.onPress}
        />
      ) : null}
    </Row>
  );
}

/** The bar beside quoted text, e.g. in a reply. */
export function QuoteBar({ tone = "accent" }: { tone?: "accent" | "info" }) {
  return (
    <View
      width={border.emphasis}
      alignSelf="stretch"
      borderRadius="$pill"
      backgroundColor={tone === "accent" ? "$accent" : "$info"}
    />
  );
}

export interface MessageComposerMenu {
  /** Names the + and the menu it opens. */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `ComposerMenuItem`s. */
  items: ReactNode;
}

export interface MessageComposerFrameProps {
  /** The text input with its send action inside, e.g. a `RichTextInput` with `trailing`. */
  children: ReactNode;
  /** Shown above the input, e.g. a reply preview or attachments. */
  header?: ReactNode;
  /** Beside the input on wide screens and in a row below it on phones, e.g. payment actions; each action fills its share of the phone row. */
  actions?: ReactNode;
  /** A + left of the input that opens its items above it, e.g. the actions moved out of the way of a draft. */
  menu?: MessageComposerMenu | undefined;
}

// Keeps the input focused, and the iOS keyboard open, while tapping the menu.
const keepInputFocus = (event: { preventDefault: () => void }) =>
  event.preventDefault();

/** Sits flush under the message list, whose content pads the space above the composer, so messages scroll right up to its top edge. */
export function MessageComposerFrame({
  children,
  header,
  actions,
  menu,
}: MessageComposerFrameProps) {
  return (
    <Stack
      gap="$sm"
      paddingHorizontal="$lg"
      paddingBottom="$md"
      backgroundColor="$background"
    >
      {header}
      <AnimatePresence>
        {menu?.open ? (
          <Row
            key="menu"
            role="group"
            aria-label={menu.label}
            gap="$sm"
            padding="$sm"
            borderRadius="$card"
            backgroundColor="$surface"
            transition="base"
            enterStyle={menuHidden}
            exitStyle={menuHidden}
            onPointerDown={keepInputFocus}
          >
            {menu.items}
          </Row>
        ) : null}
      </AnimatePresence>
      <Stack gap="$sm" $wide={{ flexDirection: "row", alignItems: "flex-end" }}>
        <Row gap="$sm" alignItems="flex-end" minWidth={0} $wide={{ flex: 1 }}>
          {menu ? (
            <IconButton
              icon="Plus"
              variant="secondary"
              accessibilityLabel={menu.label}
              aria-expanded={menu.open}
              // Turned 45°, the + reads as the × that closes the menu.
              rotate={menu.open ? "45deg" : "0deg"}
              transition="base"
              enterStyle={{ opacity: 0, scale: enterScale.pop }}
              onPointerDown={keepInputFocus}
              onPress={() => menu.onOpenChange(!menu.open)}
            />
          ) : null}
          <Stack flex={1} minWidth={0}>
            {children}
          </Stack>
        </Row>
        {actions ? (
          <Row gap="$sm" transition="base" enterStyle={{ opacity: 0 }}>
            {actions}
          </Row>
        ) : null}
      </Stack>
    </Stack>
  );
}

const menuHidden = { opacity: 0, y: space.md } as const;

export interface ComposerMenuItemProps extends Omit<
  PressableProps,
  "children" | "icon"
> {
  label: string;
  icon: IconName;
  tone?: Tone | undefined;
}

/** One action in a `MessageComposerFrame` menu: a round icon badge over a short label. */
export function ComposerMenuItem({
  label,
  icon,
  tone = "accent",
  ...props
}: ComposerMenuItemProps) {
  const colors = toneColors[tone];
  return (
    <Pressable
      flex={1}
      maxWidth="$hero"
      flexDirection="column"
      gap="$xs"
      paddingVertical="$sm"
      borderRadius="$control"
      hoverStyle={{ backgroundColor: "$surfaceRaised" }}
      pressStyle={{ backgroundColor: "$backgroundPress" }}
      {...props}
    >
      <View
        width="$controlLg"
        height="$controlLg"
        alignItems="center"
        justifyContent="center"
        borderRadius="$pill"
        backgroundColor={colors.background}
      >
        <Icon name={icon} size="lg" color={colors.color} />
      </View>
      <Text variant="caption" textAlign="center" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export interface LinkPreviewProps {
  title: string;
  site: string;
  description?: string | undefined;
  imageUri?: string | undefined;
  /** The site's icon, shown before its name. */
  faviconUri?: string | undefined;
  href: string;
}

export function LinkPreview({
  title,
  site,
  description,
  imageUri,
  faviconUri,
  href,
}: LinkPreviewProps) {
  return (
    <Anchor
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      textDecorationLine="none"
    >
      <Row
        alignItems="flex-start"
        gap="$sm"
        padding="$sm"
        borderRadius="$control"
        backgroundColor="$surface"
      >
        {imageUri ? (
          <Image
            src={imageUri}
            width="$avatar"
            height="$avatar"
            borderRadius="$sm"
            objectFit="cover"
            aria-hidden
          />
        ) : null}
        <Stack flex={1} gap="$xxs">
          <Row gap="$xs">
            {faviconUri ? (
              <Image
                src={faviconUri}
                width="$iconSm"
                height="$iconSm"
                borderRadius="$sm"
                aria-hidden
              />
            ) : null}
            <Text
              variant="caption"
              color="$accentText"
              numberOfLines={1}
              flexShrink={1}
            >
              {site}
            </Text>
          </Row>
          <Text variant="label" numberOfLines={2}>
            {title}
          </Text>
          {description ? (
            <Text variant="caption" color="$colorMuted" numberOfLines={2}>
              {description}
            </Text>
          ) : null}
        </Stack>
      </Row>
    </Anchor>
  );
}

export function MessageLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Anchor
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      color="$infoText"
      textDecorationLine="underline"
      fontFamily="$body"
      {...textVariant("body")}
    >
      {children}
    </Anchor>
  );
}

export interface FileAttachmentProps {
  name: string;
  meta?: string | undefined;
  icon?: IconName | undefined;
  onPress?: (() => void) | undefined;
  loading?: boolean | undefined;
}

export function FileAttachment({
  name,
  meta,
  icon = "FileText",
  onPress,
  loading = false,
}: FileAttachmentProps) {
  return (
    <Pressable
      gap="$sm"
      padding="$sm"
      borderRadius="$control"
      backgroundColor="$surface"
      disabled={!onPress || loading}
      aria-busy={loading}
      onPress={onPress}
    >
      <View padding="$sm" borderRadius="$sm" backgroundColor="$accentSoft">
        <Icon name={icon} color="$accentText" />
      </View>
      <Stack flex={1} gap="$xxs">
        <Text variant="label" numberOfLines={1}>
          {name}
        </Text>
        {meta ? (
          <Text variant="caption" color="$colorMuted">
            {meta}
          </Text>
        ) : null}
      </Stack>
    </Pressable>
  );
}

export interface ImageAttachmentProps {
  uri: string;
  accessibilityLabel: string;
  errorLabel: string;
  aspectRatio?: number | undefined;
  onPress?: (() => void) | undefined;
}

export function ImageAttachment(props: ImageAttachmentProps) {
  return <ImageAttachmentContent key={props.uri} {...props} />;
}

function ImageAttachmentContent({
  uri,
  accessibilityLabel,
  errorLabel,
  aspectRatio = 4 / 3,
  onPress,
}: ImageAttachmentProps) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  return (
    <Pressable
      width="100%"
      aspectRatio={aspectRatio}
      justifyContent="center"
      overflow="hidden"
      borderRadius="$control"
      backgroundColor="$neutralSoft"
      aria-label={accessibilityLabel}
      aria-busy={state === "loading"}
      disabled={!onPress || state !== "loaded"}
      onPress={onPress}
    >
      {state === "failed" ? (
        <Stack alignItems="center" gap="$xs" padding="$lg">
          <Icon name="FileText" color="$colorMuted" />
          <Text variant="caption" color="$colorMuted">
            {errorLabel}
          </Text>
        </Stack>
      ) : (
        <Image
          src={uri}
          width="100%"
          height="100%"
          objectFit="cover"
          aria-hidden
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
        />
      )}
    </Pressable>
  );
}

export interface AttachmentDraft {
  id: string;
  name: string;
  previewUri?: string | undefined;
}

export interface AttachmentTrayProps {
  accessibilityLabel: string;
  items: readonly AttachmentDraft[];
  removeLabel: (item: AttachmentDraft) => string;
  onRemove: (id: string) => void;
  /** Shows an add button; `label` is its accessibility label. */
  add?: LabeledAction | undefined;
  disabled?: boolean | undefined;
}

export function AttachmentTray({
  accessibilityLabel,
  items,
  removeLabel,
  onRemove,
  add,
  disabled,
}: AttachmentTrayProps) {
  return (
    <ScrollView
      horizontal
      role="group"
      aria-label={accessibilityLabel}
      contentContainerStyle={{ gap: space.sm }}
      flexGrow={0}
    >
      {items.map((item) => (
        <View
          key={item.id}
          position="relative"
          width="$row"
          height="$row"
          borderRadius="$control"
          overflow="hidden"
          backgroundColor="$neutralSoft"
          alignItems="center"
          justifyContent="center"
        >
          {item.previewUri ? (
            <Image
              src={item.previewUri}
              width="100%"
              height="100%"
              objectFit="cover"
              aria-label={item.name}
            />
          ) : (
            <Stack alignItems="center" gap="$xxs" paddingHorizontal="$xs">
              <Icon name="FileText" color="$colorMuted" />
              <Text variant="caption" color="$colorSubtle" numberOfLines={1}>
                {item.name}
              </Text>
            </Stack>
          )}
          <View position="absolute" top="$xxs" right="$xxs">
            <IconButton
              icon="X"
              accessibilityLabel={removeLabel(item)}
              size="sm"
              variant="secondary"
              disabled={disabled}
              onPress={() => onRemove(item.id)}
            />
          </View>
        </View>
      ))}
      {add ? (
        <Pressable
          width="$row"
          height="$row"
          justifyContent="center"
          borderRadius="$control"
          borderWidth={border.hairline}
          borderStyle="dashed"
          borderColor="$borderColorHover"
          aria-label={add.label}
          disabled={disabled}
          onPress={add.onPress}
        >
          <Icon name="Plus" color="$colorMuted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

export interface EmojiPickerProps {
  accessibilityLabel: string;
  emojis: readonly string[];
  onSelect: (emoji: string) => void;
  /** Shows a plus button after the emojis, e.g. to reveal the full set; `label` is its accessibility label. */
  more?: LabeledAction | undefined;
}

export function EmojiPicker({
  accessibilityLabel,
  emojis,
  onSelect,
  more,
}: EmojiPickerProps) {
  return (
    <Row role="group" aria-label={accessibilityLabel} flexWrap="wrap" gap="$xs">
      {emojis.map((emoji) => (
        <Pressable
          key={emoji}
          aria-label={emoji}
          width="$control"
          height="$control"
          justifyContent="center"
          borderRadius="$pill"
          hoverStyle={{ backgroundColor: "$neutralSoft" }}
          onPress={() => onSelect(emoji)}
        >
          <Text variant="heading">{emoji}</Text>
        </Pressable>
      ))}
      {more ? (
        <Pressable
          aria-label={more.label}
          width="$control"
          height="$control"
          justifyContent="center"
          borderRadius="$pill"
          hoverStyle={{ backgroundColor: "$neutralSoft" }}
          onPress={more.onPress}
        >
          <Icon name="Plus" color="$colorMuted" />
        </Pressable>
      ) : null}
    </Row>
  );
}

export interface EmojiCatalogGroup {
  key: string;
  /** Tab name, read by assistive tech; the tab shows `icon`. */
  label: string;
  icon: IconName;
  emojis: readonly string[];
}

export interface EmojiCatalogProps {
  accessibilityLabel: string;
  groups: readonly EmojiCatalogGroup[];
  onSelect: (emoji: string) => void;
}

/** The full emoji set behind icon tabs, one group shown at a time; the grid scrolls within a fixed height. */
export function EmojiCatalog({
  accessibilityLabel,
  groups,
  onSelect,
}: EmojiCatalogProps) {
  const [activeKey, setActiveKey] = useState(groups[0]?.key ?? "");
  const active = groups.find((group) => group.key === activeKey) ?? groups[0];
  return (
    <Stack gap="$sm">
      <Row role="tablist" gap="$xxs" justifyContent="space-between">
        {groups.map((group) => (
          <IconButton
            key={group.key}
            icon={group.icon}
            accessibilityLabel={group.label}
            size="sm"
            variant={group.key === active?.key ? "secondary" : "ghost"}
            role="tab"
            aria-selected={group.key === active?.key}
            onPress={() => setActiveKey(group.key)}
          />
        ))}
      </Row>
      {active ? (
        // Remounting on a tab change starts the grid at its top.
        <ScrollView key={active.key} maxHeight="$qr" flexGrow={0}>
          <EmojiPicker
            accessibilityLabel={`${accessibilityLabel}: ${active.label}`}
            emojis={active.emojis}
            onSelect={onSelect}
          />
        </ScrollView>
      ) : null}
    </Stack>
  );
}
